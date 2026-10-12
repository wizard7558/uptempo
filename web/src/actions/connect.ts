"use server";

import { isSingleMode } from "@/lib/config/mode";
import { requireStaff } from "@/lib/auth/rbac";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { publicDb } from "@/lib/db";
import { tenants, webhookLookup } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createConnectAccount,
  createOnboardingLink,
  getConnectAccountStatus,
} from "@/lib/stripe/connect";
import { trackEvent } from "@/lib/analytics/events";
import { revalidateTag } from "next/cache";
import { onboardingTag } from "@/lib/onboarding/state";

type ConnectStatus =
  | { connected: false }
  | {
      connected: true;
      accountId: string;
      detailsSubmitted: boolean;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
    };

/**
 * Get the Stripe Connect status for the current tenant.
 */
export async function getConnectStatus(): Promise<ConnectStatus> {
  const { tenantSlug: slug } = await requireStaff();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) throw new Error("Tenant not found");

  if (!tenant.stripeConnectAccountId) {
    return { connected: false };
  }

  try {
    const status = await getConnectAccountStatus(tenant.stripeConnectAccountId);
    return {
      connected: true,
      accountId: tenant.stripeConnectAccountId,
      ...status,
    };
  } catch {
    // Stripe API unreachable or account invalid — show as not connected
    return { connected: false };
  }
}

/**
 * Create a Stripe Connect account for the tenant (if not already created)
 * and return the onboarding URL. If an account already exists, returns a
 * fresh onboarding link for completing or re-entering the flow.
 */
export async function setupConnectAccount(
  opts?: {
    native?: "owner" | "client";
    /** Where Stripe's hosted flow returns to. Allowlisted — never arbitrary. */
    returnPath?: "/onboarding" | "/settings/billing";
  },
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  if (isSingleMode()) throw new Error("Not available on this install.");
  const { tenantSlug: slug } = await requireStaff();
  try {
    const tenant = await getTenantBySlug(slug);
    if (!tenant) return { success: false, error: "Tenant not found" };

    let accountId = tenant.stripeConnectAccountId;

    if (!accountId) {
      // Create new Connect account
      const result = await createConnectAccount({
        email: `${slug}@bookuptempo.com`,
        businessName: tenant.name,
        tenantSlug: slug,
      });
      accountId = result.accountId;

      // Save account ID to tenants table
      await publicDb
        .update(tenants)
        .set({ stripeConnectAccountId: accountId, updatedAt: new Date() })
        .where(eq(tenants.slug, slug));

      // Backfill webhook lookup for O(1) routing
      await publicDb
        .insert(webhookLookup)
        .values({
          lookupType: "stripe_connect",
          externalId: accountId,
          tenantSlug: slug,
        })
        .onConflictDoNothing();

      // The onboarding checklist derives its `stripe` flag from this column —
      // invalidate so the wizard/gate see the new account immediately.
      revalidateTag(onboardingTag(slug));
    }

    // Create onboarding link (works for both new and existing accounts)
    const { url } = await createOnboardingLink({
      accountId,
      tenantSlug: slug,
      native: opts?.native,
      returnPath:
        opts?.returnPath === "/onboarding" ? "/onboarding" : undefined,
    });

    trackEvent("stripe.connect_started", {}, { tenantSlug: slug });
    return { success: true, url };
  } catch (error) {
    console.error("[Stripe Connect] setupConnectAccount failed:", error);
    const message = error instanceof Error ? error.message : "Failed to connect to Stripe";
    return { success: false, error: message };
  }
}

/**
 * Create a new onboarding URL for an existing Connect account.
 * Used for the "Continue setup" button when onboarding is incomplete.
 */
export async function createOnboardingUrl(
  opts?: { native?: "owner" | "client" },
): Promise<{ url: string }> {
  if (isSingleMode()) throw new Error("Not available on this install.");
  const { tenantSlug: slug } = await requireStaff();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) throw new Error("Tenant not found");

  if (!tenant.stripeConnectAccountId) {
    throw new Error("No Connect account found. Use setupConnectAccount first.");
  }

  const { url } = await createOnboardingLink({
    accountId: tenant.stripeConnectAccountId,
    tenantSlug: slug,
    native: opts?.native,
  });

  return { url };
}
