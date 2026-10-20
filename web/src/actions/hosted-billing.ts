"use server";

import { countBillableStaff } from "@/lib/billing/billable-staff";
import { hostedMonthlyCents } from "@/lib/billing/hosted-pricing";
import {
  processingRateBps,
  processingRateLabel,
} from "@/lib/billing/processing-fee";
import { isSingleMode } from "@/lib/config/mode";
import { requireStaff } from "@/lib/auth/rbac";
import { getStripe } from "@/lib/stripe/server";
import { billingSettingsUrl } from "@/lib/stripe/connect";
import { getTenantBySlug } from "@/lib/tenant/registry";
import messages from "@/i18n/messages/en.json";

export type HostedPlan = {
  comped: boolean;
  billableStaff: number;
  smsLineStatus: "off" | "shared" | "pending" | "action_needed" | "active";
  monthlyCents: number;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  processingLabel: string;
  hasBillingAccount: boolean;
};

/** The owner's hosted plan summary, or null on a self-hosted install. */
export async function getHostedPlan(): Promise<HostedPlan | null> {
  const { tenantSlug } = await requireStaff("owner");
  if (isSingleMode()) return null;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return null;

  const billableStaff = await countBillableStaff(tenantSlug);

  let trialEndsAt: string | null = null;
  if (tenant.stripeSubscriptionId) {
    try {
      const sub = await getStripe().subscriptions.retrieve(
        tenant.stripeSubscriptionId,
      );
      if (sub.status === "trialing" && sub.trial_end) {
        trialEndsAt = new Date(sub.trial_end * 1000).toISOString();
      }
    } catch (error) {
      console.error("[billing] getHostedPlan trial lookup failed", tenantSlug, error);
    }
  }

  return {
    comped: tenant.comped === 1,
    billableStaff,
    smsLineStatus: tenant.smsLineStatus,
    monthlyCents: hostedMonthlyCents({
      staff: billableStaff,
      textLine:
        tenant.smsLineStatus === "active" ||
        (tenant.smsLineStatus === "shared" && tenant.billingSwitchedAt != null),
      texts: 0,
    }),
    trialEndsAt,
    subscriptionStatus: tenant.subscriptionStatus ?? null,
    processingLabel: processingRateLabel(
      processingRateBps({
        comped: tenant.comped,
        processingRateBps: tenant.processingRateBps,
      }),
    ),
    hasBillingAccount: tenant.platformStripeCustomerId != null,
  };
}

/** Stripe Customer Portal session for updating the card or viewing invoices. */
export async function openBillingPortal(): Promise<
  { url: string } | { error: string }
> {
  const { tenantSlug } = await requireStaff("owner");
  const failure = { error: messages.settings.billing.portalError };
  if (isSingleMode()) return failure;
  try {
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant?.platformStripeCustomerId) return failure;
    const session = await getStripe().billingPortal.sessions.create({
      customer: tenant.platformStripeCustomerId,
      return_url: billingSettingsUrl(),
    });
    return { url: session.url };
  } catch (error) {
    console.error("[billing] openBillingPortal failed", tenantSlug, error);
    return failure;
  }
}
