import { and, eq, isNull, or } from "drizzle-orm";
import type Stripe from "stripe";
import { HOSTED_PLAN_PURPOSE } from "@/lib/billing/hosted-catalog";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { getInvoiceSubscriptionId } from "@/lib/stripe/invoice-subscription";
import { getStripe } from "@/lib/stripe/server";

/**
 * Platform webhook events that can concern a business's own hosted plan. The
 * same event types also carry client membership subscriptions, so the handler
 * decides by subscription metadata.
 */
export const HOSTED_PLAN_EVENT_TYPES: readonly string[] = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
];

/**
 * Mirror a hosted-plan subscription's status onto the public tenants row.
 * Returns true when the event belongs to the hosted plan (handled, even if no
 * row matched), false when the caller should keep processing it. Never touches
 * tenant schemas or client memberships.
 */
export async function handleHostedPlanEvent(
  event: Stripe.Event,
): Promise<boolean> {
  if (!HOSTED_PLAN_EVENT_TYPES.includes(event.type)) return false;
  if (event.account) return false;

  const isInvoice = event.type.startsWith("invoice.");
  let subscriptionId: string | undefined;
  let eventSubscription: Stripe.Subscription | undefined;
  if (isInvoice) {
    subscriptionId = getInvoiceSubscriptionId(
      event.data.object as Stripe.Invoice,
    );
  } else {
    eventSubscription = event.data.object as Stripe.Subscription;
    subscriptionId = eventSubscription.id;
    const purpose = eventSubscription.metadata?.purpose;
    if (purpose && purpose !== HOSTED_PLAN_PURPOSE) return false;
  }
  if (!subscriptionId) return false;

  // Events can arrive out of order: read the current status from Stripe.
  let sub: Stripe.Subscription;
  try {
    sub = await getStripe().subscriptions.retrieve(subscriptionId);
  } catch {
    if (!eventSubscription) return false;
    sub = eventSubscription;
  }

  const slug = sub.metadata?.tenantSlug;
  if (sub.metadata?.purpose !== HOSTED_PLAN_PURPOSE || !slug) return false;

  const updated = await publicDb
    .update(tenants)
    .set({
      stripeSubscriptionId: sub.id,
      subscriptionStatus: sub.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tenants.slug, slug),
        or(
          eq(tenants.stripeSubscriptionId, sub.id),
          isNull(tenants.stripeSubscriptionId),
        ),
      ),
    )
    .returning({ slug: tenants.slug });

  if (updated.length === 0) {
    console.warn(
      `Stripe webhook: hosted plan subscription ${sub.id} for ${slug} did not match a tenant row`,
    );
  }
  return true;
}
