import { getStripe } from "./server";

/** New Connect accounts pay out weekly on Monday (D12). Existing accounts switch in 6.5b. */
const WEEKLY_PAYOUT_SCHEDULE = {
  interval: "weekly" as const,
  weekly_anchor: "monday" as const,
};

/**
 * Create a Stripe Connect account for a business tenant using controller
 * properties. The connected account uses an Express-style dashboard with
 * the platform (application) bearing fees and losses, and Stripe handling
 * requirement collection during the hosted onboarding flow.
 */
export async function createConnectAccount(params: {
  email: string;
  businessName: string;
  tenantSlug: string;
  country?: string;
}): Promise<{ accountId: string }> {
  const account = await getStripe().accounts.create({
    controller: {
      stripe_dashboard: { type: "express" },
      fees: { payer: "application" },
      losses: { payments: "application" },
      requirement_collection: "stripe",
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
      afterpay_clearpay_payments: { requested: true },
      cashapp_payments: { requested: true },
      link_payments: { requested: true },
    },
    country: params.country ?? "US",
    email: params.email,
    business_profile: {
      name: params.businessName,
    },
    metadata: {
      tenantSlug: params.tenantSlug,
    },
    settings: {
      payouts: { schedule: WEEKLY_PAYOUT_SCHEDULE },
    },
  });
  return { accountId: account.id };
}

/** Move an existing Connect account to the weekly Monday payout schedule (6.5b). */
export async function setWeeklyPayouts(accountId: string): Promise<void> {
  await getStripe().accounts.update(accountId, {
    settings: {
      payouts: { schedule: WEEKLY_PAYOUT_SCHEDULE },
    },
  }, { timeout: 30_000, maxNetworkRetries: 0 });
}

function resolveRootDomain(rootDomain?: string): string {
  return (rootDomain ?? process.env.ROOT_DOMAIN ?? "bookuptempo.com").trim();
}

/** Absolute URL of Settings, Billing; the return target for Stripe-hosted flows. */
export function billingSettingsUrl(rootDomain?: string): string {
  return `https://${resolveRootDomain(rootDomain)}/settings/billing`;
}

/**
 * Generate a Stripe-hosted onboarding URL for a Connect account.
 *
 * The business owner opens this link to complete identity verification,
 * bank account setup, and other onboarding requirements.
 */
export async function createOnboardingLink(params: {
  accountId: string;
  tenantSlug: string;
  rootDomain?: string;
  /** When set, return/refresh URLs bounce back to the native app's scheme. */
  native?: "owner" | "client";
  /**
   * Web return destination. Only "/onboarding" is honored (the wizard's
   * Payments step); anything else uses the default /settings/billing.
   */
  returnPath?: "/onboarding";
}): Promise<{ url: string }> {
  const domain = resolveRootDomain(params.rootDomain);

  const webBase =
    params.returnPath === "/onboarding"
      ? `https://${domain}/onboarding`
      : billingSettingsUrl(domain);

  // Stripe requires https return/refresh URLs (custom schemes are rejected),
  // so for native we point at the bounce endpoint which redirects to the app.
  const refreshUrl = params.native
    ? `https://${domain}/api/native/return?app=${params.native}&path=connect-callback&error=refresh`
    : webBase;
  const returnUrl = params.native
    ? `https://${domain}/api/native/return?app=${params.native}&path=connect-callback&stripe_setup=complete`
    : `${webBase}?stripe_setup=complete`;

  const accountLink = await getStripe().accountLinks.create({
    account: params.accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  return { url: accountLink.url };
}

/**
 * Check whether a Connect account has completed onboarding and is
 * ready to accept charges and receive payouts.
 */
export async function getConnectAccountStatus(accountId: string): Promise<{
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}> {
  const account = await getStripe().accounts.retrieve(accountId);
  return {
    detailsSubmitted: account.details_submitted ?? false,
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  };
}
