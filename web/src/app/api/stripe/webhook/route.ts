import { getEmailT } from "@/lib/terms/email";
import { getT } from "@/lib/terms/server";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import React from "react";
import { withTenantDb } from "@/lib/db/tenant";
import { listActiveTenants, findTenantByConnectAccountId, getTenantBySlug } from "@/lib/tenant/registry";
import { getStripe } from "@/lib/stripe/server";
import { verifyWebhookSignature } from "@/lib/stripe/webhook";
import { sendEmail } from "@/lib/email/send";
import { publicDb } from "@/lib/db";
import { webhookLookup, tenants } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { trackEvent } from "@/lib/analytics/events";
import { creditStoredValueIdempotent } from "@/lib/services/stored-value-ledger";
import { grantMembershipCredits } from "@/lib/credits/membership";
import { getInvoiceSubscriptionId } from "@/lib/stripe/invoice-subscription";
import { handleHostedPlanEvent } from "@/lib/billing/subscription-webhook";

export const dynamic = 'force-dynamic';

function subscriptionPeriodBounds(sub: Stripe.Subscription): {
  start: Date | null;
  end: Date | null;
} {
  const s = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  return {
    start:
      s.current_period_start != null
        ? new Date(s.current_period_start * 1000)
        : null,
    end:
      s.current_period_end != null
        ? new Date(s.current_period_end * 1000)
        : null,
  };
}

/**
 * Look up tenant slug from the webhook_lookup table (O(1)).
 * Returns null if no entry exists yet.
 */
async function lookupTenantByWebhook(
  lookupType: string,
  externalId: string,
): Promise<string | null> {
  const [row] = await publicDb
    .select({ tenantSlug: webhookLookup.tenantSlug })
    .from(webhookLookup)
    .where(
      and(
        eq(webhookLookup.lookupType, lookupType),
        eq(webhookLookup.externalId, externalId),
      ),
    )
    .limit(1);
  return row?.tenantSlug ?? null;
}

/**
 * Backfill webhook_lookup for future O(1) lookups.
 * Uses onConflictDoNothing to handle races safely.
 */
async function backfillWebhookLookup(
  lookupType: string,
  externalId: string,
  tenantSlug: string,
): Promise<void> {
  await publicDb
    .insert(webhookLookup)
    .values({ lookupType, externalId, tenantSlug })
    .onConflictDoNothing();
}

/**
 * Find which tenant owns a Stripe customer.
 * 1. Try O(1) lookup table first.
 * 2. Fall back to scanning all tenants (for pre-existing data).
 * 3. Backfill lookup table on fallback hit for next time.
 */
async function findTenantForStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  // Fast path: O(1) lookup
  const cached = await lookupTenantByWebhook("stripe_customer", stripeCustomerId);
  if (cached) return cached;

  // Slow fallback: scan all tenant schemas
  const tenants = await listActiveTenants();
  for (const tenant of tenants) {
    const [client] = await withTenantDb(tenant.slug, async (db, { clients }) => {
      return db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.stripeCustomerId, stripeCustomerId))
        .limit(1);
    });
    if (client) {
      // Backfill for next time
      await backfillWebhookLookup("stripe_customer", stripeCustomerId, tenant.slug);
      return tenant.slug;
    }
  }
  return null;
}

/**
 * Find which tenant owns a charge by Stripe payment intent.
 * 1. Try metadata (already present on PaymentIntent objects).
 * 2. Try lookup table via customer ID (O(1)).
 * 3. Fall back to scanning all tenants for the payment intent ID.
 * 4. Backfill lookup table on fallback hit.
 */
async function findTenantForPaymentIntent(paymentIntent: Stripe.PaymentIntent): Promise<string | null> {
  // Fast path 1: metadata
  const metadataSlug = paymentIntent.metadata?.tenantSlug as string | undefined;
  if (metadataSlug) return metadataSlug;

  // Fast path 2: lookup table via customer ID
  const customerId =
    typeof paymentIntent.customer === "string"
      ? paymentIntent.customer
      : paymentIntent.customer?.id;
  if (customerId) {
    const cached = await lookupTenantByWebhook("stripe_customer", customerId);
    if (cached) return cached;
  }

  // Slow fallback: scan all tenant schemas for the payment intent
  const tenants = await listActiveTenants();
  for (const tenant of tenants) {
    const [charge] = await withTenantDb(tenant.slug, async (db, { charges }) => {
      return db
        .select({ id: charges.id })
        .from(charges)
        .where(eq(charges.stripePaymentIntentId, paymentIntent.id))
        .limit(1);
    });
    if (charge) {
      // Backfill customer lookup for next time
      if (customerId) {
        await backfillWebhookLookup("stripe_customer", customerId, tenant.slug);
      }
      return tenant.slug;
    }
  }
  return null;
}

async function findTenantForSubscription(
  subscriptionId: string,
): Promise<string | null> {
  const cached = await lookupTenantByWebhook(
    "stripe_subscription",
    subscriptionId,
  );
  if (cached) return cached;

  try {
    const sub = await getStripe().subscriptions.retrieve(subscriptionId);
    const slug = sub.metadata?.tenantSlug as string | undefined;
    if (slug) {
      await backfillWebhookLookup(
        "stripe_subscription",
        subscriptionId,
        slug,
      );
      return slug;
    }
  } catch {
    // subscription may be deleted
  }
  return null;
}

function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): "active" | "past_due" | "cancelled" | "paused" {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "cancelled";
    case "paused":
      return "paused";
    default:
      return "past_due";
  }
}

export async function POST(req: Request) {
  // CRITICAL: Use req.text() to get raw body for signature verification
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(body, signature);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 },
    );
  }

  // Connected account events: route by event.account field
  if (event.account) {
    const tenantSlug = await findTenantByConnectAccountId(event.account);
    if (!tenantSlug) {
      console.warn(`Stripe webhook: No tenant found for Connect account ${event.account}`);
      return NextResponse.json({ received: true });
    }

    switch (event.type) {
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        // Update tenant record with latest Connect status
        await publicDb
          .update(tenants)
          .set({ updatedAt: new Date() })
          .where(eq(tenants.stripeConnectAccountId, event.account));
        console.log(`Connect account updated for tenant ${tenantSlug}: charges_enabled=${account.charges_enabled}, payouts_enabled=${account.payouts_enabled}`);
        break;
      }
      case "payout.paid": {
        const paidPayout = event.data.object as Stripe.Payout;
        trackEvent("payout.paid", { payoutId: paidPayout.id, amountCents: paidPayout.amount, currency: paidPayout.currency }, { tenantSlug });
        console.log(`Payout ${event.type} for tenant ${tenantSlug}: ${paidPayout.id}`);
        break;
      }
      case "payout.failed": {
        const failedPayout = event.data.object as Stripe.Payout;
        trackEvent("payout.failed", { payoutId: failedPayout.id, amountCents: failedPayout.amount, currency: failedPayout.currency, failureCode: failedPayout.failure_code ?? null, failureMessage: failedPayout.failure_message ?? null }, { tenantSlug });
        console.log(`Payout ${event.type} for tenant ${tenantSlug}: ${failedPayout.id}`);
        break;
      }
    }

    return NextResponse.json({ received: true });
  }

  // Our own hosted plan subscription: mirror status to the public tenants row.
  if (await handleHostedPlanEvent(event)) {
    return NextResponse.json({ received: true });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Storefront retail orders → record the order + raise a dashboard alert.
      if (
        session.metadata?.purpose === "storefront_order" &&
        session.payment_status === "paid"
      ) {
        const { recordStorefrontOrder } = await import(
          "@/lib/services/storefront"
        );
        try {
          await recordStorefrontOrder(session);
        } catch (err) {
          console.error("Stripe webhook: failed to record storefront order:", err);
          // 500 → Stripe retries; the unique session index keeps this idempotent.
          return NextResponse.json(
            { error: "Failed to record order" },
            { status: 500 },
          );
        }
      }
      if (
        session.metadata?.purpose === "gift_card_purchase" &&
        session.payment_status === "paid"
      ) {
        const { issueGiftCardFromSession } = await import("@/lib/gift-cards/purchase");
        try {
          await issueGiftCardFromSession(session);
        } catch (err) {
          console.error("Stripe webhook: failed to issue gift card:", err);
          return NextResponse.json(
            { error: "Failed to issue gift card" },
            { status: 500 },
          );
        }
      }
      break;
    }

    case "setup_intent.succeeded": {
      const setupIntent = event.data.object as Stripe.SetupIntent;
      const customerId =
        typeof setupIntent.customer === "string"
          ? setupIntent.customer
          : setupIntent.customer?.id;
      const paymentMethodId =
        typeof setupIntent.payment_method === "string"
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id;

      if (customerId && paymentMethodId) {
        // Try metadata first, then lookup table, then scan
        const tenantSlug =
          (setupIntent.metadata?.tenantSlug as string) ||
          (await findTenantForStripeCustomer(customerId));

        if (!tenantSlug) {
          console.warn(`Stripe webhook: No tenant found for customer ${customerId}`);
          break;
        }

        // Find client by stripeCustomerId and save payment method
        const client = await withTenantDb(tenantSlug, async (db, { clients }) => {
          const [c] = await db
            .select()
            .from(clients)
            .where(eq(clients.stripeCustomerId, customerId))
            .limit(1);
          return c;
        });

        if (client) {
          await withTenantDb(tenantSlug, async (db, { clients }) => {
            await db
              .update(clients)
              .set({
                stripePaymentMethodId: paymentMethodId,
                updatedAt: new Date(),
              })
              .where(eq(clients.id, client.id));
          });

          // Send confirmation email
          try {
            const pm = await getStripe().paymentMethods.retrieve(paymentMethodId);
            if (client.email) {
              const tenant = await getTenantBySlug(tenantSlug);
              const businessName = tenant?.name ?? undefined;
              const emailT = await getEmailT(tenantSlug, "emails");

              await sendEmail({
                to: client.email,
                subject: "Card saved on file",
                react: React.createElement("div", null,
                  React.createElement("p", null, `Hi ${client.name},`),
                  React.createElement("p", null, `Your ${pm.card?.brand?.toUpperCase() ?? "card"} ending in ${pm.card?.last4 ?? "****"} has been saved on file.`),
                  React.createElement("p", null, emailT("cardSaved.policyNote")),
                  React.createElement("p", null, "You can manage your card at any time from your account page."),
                ),
                businessName,
              });
            }
          } catch (emailErr) {
            // Email failure should NOT fail the webhook response
            console.error("Failed to send card saved email:", emailErr);
          }
        }
      }
      break;
    }

    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      // Platform fee charges are recorded synchronously by the billing cron.
      if (paymentIntent.metadata?.purpose === "platform_fee") break;

      if (paymentIntent.metadata?.purpose === "beauty_bank_topup") {
        const tenantSlug =
          (paymentIntent.metadata.tenantSlug as string) ||
          (await findTenantForPaymentIntent(paymentIntent));
        const clientId = paymentIntent.metadata.clientId as string | undefined;
        if (tenantSlug && clientId) {
          const topUpNote = (await getT("errors", tenantSlug))(
            "stripeWebhook.topUpLedgerNote",
          );
          await withTenantDb(tenantSlug, async (db, tables) => {
            await db.transaction(async (tx) => {
              await creditStoredValueIdempotent(tx, tables, {
                clientId,
                type: "topup_credit",
                amountCents: paymentIntent.amount,
                referenceId: paymentIntent.id,
                note: topUpNote,
              });
            });
          });
          trackEvent(
            "beauty_bank.topup_succeeded",
            { clientId, amountCents: paymentIntent.amount },
            { tenantSlug },
          );
        }
        break;
      }

      const tenantSlug = await findTenantForPaymentIntent(paymentIntent);

      if (!tenantSlug) break;

      // Update the corresponding charge record to "completed"
      await withTenantDb(tenantSlug, async (db, { charges }) => {
        const [charge] = await db
          .select()
          .from(charges)
          .where(eq(charges.stripePaymentIntentId, paymentIntent.id))
          .limit(1);

        if (charge) {
          await db
            .update(charges)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(charges.id, charge.id));
          trackEvent("charge.succeeded", { chargeId: charge.id, paymentIntentId: paymentIntent.id }, { tenantSlug });
        }
      });
      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      // Platform fee charges are recorded synchronously by the billing cron.
      if (paymentIntent.metadata?.purpose === "platform_fee") break;

      const failureMessage =
        paymentIntent.last_payment_error?.message ?? "Payment failed";

      const tenantSlug = await findTenantForPaymentIntent(paymentIntent);

      if (!tenantSlug) break;

      await withTenantDb(tenantSlug, async (db, { charges }) => {
        const [charge] = await db
          .select()
          .from(charges)
          .where(eq(charges.stripePaymentIntentId, paymentIntent.id))
          .limit(1);

        if (charge) {
          await db
            .update(charges)
            .set({
              status: "failed",
              failureReason: failureMessage,
              updatedAt: new Date(),
            })
            .where(eq(charges.id, charge.id));
          trackEvent("charge.failed", { chargeId: charge.id, paymentIntentId: paymentIntent.id, failureMessage }, { tenantSlug });
        }
      });
      break;
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.amount_paid <= 0) break;

      const subId = getInvoiceSubscriptionId(invoice);
      if (!subId) break;

      const sub = await getStripe().subscriptions.retrieve(subId);
      if (sub.metadata?.purpose !== "beauty_bank_membership") break;

      const tenantSlug = sub.metadata.tenantSlug as string;
      const clientId = sub.metadata.clientId as string;
      if (!tenantSlug || !clientId) break;

      await withTenantDb(tenantSlug, async (db, tables) => {
        // What the plan gives members decides what this payment does. A membership we
        // cannot find keeps the original behavior (stored value).
        const { clientMemberships, membershipPlans } = tables;
        const [plan] = await db
          .select({
            kind: membershipPlans.kind,
            name: membershipPlans.name,
            creditsPerPeriod: membershipPlans.creditsPerPeriod,
            rolloverMax: membershipPlans.rolloverMax,
            eligibleServiceIds: membershipPlans.eligibleServiceIds,
            clientMembershipId: clientMemberships.id,
          })
          .from(clientMemberships)
          .innerJoin(membershipPlans, eq(membershipPlans.id, clientMemberships.planId))
          .where(
            and(
              eq(clientMemberships.stripeSubscriptionId, subId),
              eq(clientMemberships.clientId, clientId),
            ),
          )
          .limit(1);
        const kind = plan?.kind ?? "stored_value";

        if (kind === "stored_value") {
          await db.transaction(async (tx) => {
            await creditStoredValueIdempotent(tx, tables, {
              clientId,
              type: "subscription_credit",
              amountCents: invoice.amount_paid,
              referenceId: invoice.id,
              note: "Membership monthly credit",
            });
          });
        } else if (kind === "credits" && plan?.creditsPerPeriod) {
          await db.transaction(async (tx) => {
            await grantMembershipCredits(tx, tables, {
              clientMembershipId: plan.clientMembershipId,
              clientId,
              planName: plan.name,
              perPeriod: plan.creditsPerPeriod!,
              rolloverMax: plan.rolloverMax,
              eligible: plan.eligibleServiceIds,
              invoiceId: invoice.id,
            });
          });
        }
        // kind === "discount": nothing to grant.
      });

      await withTenantDb(tenantSlug, async (db, { clientMemberships }) => {
        const { start: periodStart, end: periodEnd } =
          subscriptionPeriodBounds(sub);
        await db
          .update(clientMemberships)
          .set({
            status: "active",
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(clientMemberships.stripeSubscriptionId, subId),
              eq(clientMemberships.clientId, clientId),
            ),
          );
      });

      trackEvent(
        "beauty_bank.subscription_invoice_paid",
        { clientId, invoiceId: invoice.id },
        { tenantSlug },
      );
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = getInvoiceSubscriptionId(invoice);
      if (!subId) break;

      const tenantSlug = await findTenantForSubscription(subId);
      if (!tenantSlug) break;

      await withTenantDb(tenantSlug, async (db, { clientMemberships }) => {
        await db
          .update(clientMemberships)
          .set({ status: "past_due", updatedAt: new Date() })
          .where(eq(clientMemberships.stripeSubscriptionId, subId));
      });
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const tenantSlug = await findTenantForSubscription(subscription.id);
      if (!tenantSlug) break;

      const status = mapStripeSubscriptionStatus(subscription.status);
      const { start: periodStart, end: periodEnd } =
        subscriptionPeriodBounds(subscription);
      await withTenantDb(tenantSlug, async (db, { clientMemberships }) => {
        await db
          .update(clientMemberships)
          .set({
            status,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            cancelledAt:
              subscription.canceled_at != null
                ? new Date(subscription.canceled_at * 1000)
                : null,
            updatedAt: new Date(),
          })
          .where(
            eq(clientMemberships.stripeSubscriptionId, subscription.id),
          );
      });
      break;
    }
  }

  return NextResponse.json({ received: true });
}
