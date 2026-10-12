"use server";

import { desc, eq } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { tenants, platformCharges } from "@/lib/db/schema";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { AuthError, requireRole } from "@/lib/auth/rbac";
import { getStripe } from "@/lib/stripe/server";

type TenantRow = typeof tenants.$inferSelect;

/**
 * Ensure the salon has a Stripe Customer on the PLATFORM account for billing.
 * Returns the customer id, persisting it on the tenant when newly created.
 */
async function getOrCreatePlatformCustomer(
  tenant: Pick<TenantRow, "slug" | "name" | "platformStripeCustomerId">,
): Promise<string> {
  if (tenant.platformStripeCustomerId) return tenant.platformStripeCustomerId;

  const customer = await getStripe().customers.create({
    name: tenant.name,
    metadata: { tenantSlug: tenant.slug, purpose: "platform_billing" },
  });

  await publicDb
    .update(tenants)
    .set({ platformStripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(tenants.slug, tenant.slug));

  return customer.id;
}

/**
 * Start collecting the salon owner's card for platform billing. Owner-only.
 * Returns a SetupIntent client secret for the Stripe PaymentElement.
 */
export async function createPlatformBillingSetupIntent(): Promise<{
  clientSecret: string | null;
}> {
  const session = await requireRole("owner");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = session.tenantSlug;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) throw new Error("Tenant not found");

  const customerId = await getOrCreatePlatformCustomer(tenant);
  const setupIntent = await getStripe().setupIntents.create({
    customer: customerId,
    automatic_payment_methods: { enabled: true },
    usage: "off_session",
    metadata: { tenantSlug: slug, purpose: "platform_billing" },
  });
  return { clientSecret: setupIntent.client_secret };
}

/**
 * Persist the card the owner just saved as the salon's default platform payment
 * method. Owner-only.
 */
export async function savePlatformPaymentMethod(
  paymentMethodId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireRole("owner");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  if (!paymentMethodId.startsWith("pm_")) {
    return { success: false, error: "Invalid payment method" };
  }
  const slug = session.tenantSlug;
  const tenant = await getTenantBySlug(slug);
  if (!tenant?.platformStripeCustomerId) {
    return { success: false, error: "No billing customer on file" };
  }

  try {
    // Detach a previous card if it's being replaced.
    if (
      tenant.platformPaymentMethodId &&
      tenant.platformPaymentMethodId !== paymentMethodId
    ) {
      try {
        await getStripe().paymentMethods.detach(tenant.platformPaymentMethodId);
      } catch (err) {
    if (err instanceof AuthError) throw err;
        // already detached / not attached — proceed
      }
    }
    await getStripe().customers.update(tenant.platformStripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    await publicDb
      .update(tenants)
      .set({ platformPaymentMethodId: paymentMethodId, updatedAt: new Date() })
      .where(eq(tenants.slug, slug));
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error("[PlatformBilling] savePlatformPaymentMethod failed:", err);
    return { success: false, error: "Could not save card" };
  }
}

export interface PlatformBillingSettings {
  billingEnabled: boolean;
  card: { brand: string; last4: string } | null;
  recentCharges: Array<{
    periodStart: string;
    amountChargedCents: number;
    status: string;
    failureReason: string | null;
  }>;
}

/** Owner-facing platform-billing status: flag, card on file, recent charges. */
export async function getPlatformBillingSettings(): Promise<PlatformBillingSettings> {
  const session = await requireRole("owner");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = session.tenantSlug;
  const tenant = await getTenantBySlug(slug);

  let card: { brand: string; last4: string } | null = null;
  if (tenant?.platformPaymentMethodId) {
    try {
      const pm = await getStripe().paymentMethods.retrieve(
        tenant.platformPaymentMethodId,
      );
      if (pm.card) card = { brand: pm.card.brand, last4: pm.card.last4 };
    } catch (err) {
    if (err instanceof AuthError) throw err;
      card = null;
    }
  }

  const recent = await publicDb
    .select({
      periodStart: platformCharges.periodStart,
      amountChargedCents: platformCharges.amountChargedCents,
      status: platformCharges.status,
      failureReason: platformCharges.failureReason,
    })
    .from(platformCharges)
    .where(eq(platformCharges.tenantSlug, slug))
    .orderBy(desc(platformCharges.periodStart))
    .limit(12);

  return {
    billingEnabled: (tenant?.billingEnabled ?? 0) === 1,
    card,
    recentCharges: recent.map((r) => ({
      periodStart: r.periodStart,
      amountChargedCents: r.amountChargedCents,
      status: r.status,
      failureReason: r.failureReason,
    })),
  };
}
