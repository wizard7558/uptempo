import { requireRole } from "@/lib/auth/rbac";
import { getConnectStatus } from "@/actions/connect";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { BillingStatus } from "./billing-status";
import { getPlatformFeePreview } from "@/actions/billing-preview";
import { getPlatformBillingSettings } from "@/actions/platform-billing";
import { getBusinessSettings } from "@/actions/policies";
import { getOnboardingState } from "@/actions/onboarding";
import { isSingleMode } from "@/lib/config/mode";
import { getTenantSlug } from "@/lib/tenant/context";
import { getBaseUrl } from "@/lib/utils";
import { PlatformFeePreviewCard } from "@/components/settings/platform-fee-preview";
import { PlatformBillingCard } from "@/components/settings/platform-billing-card";
import { SelfHostedPaymentsCard } from "@/components/settings/self-hosted-payments-card";
import { CardOnFilePrompt } from "@/components/settings/card-on-file-prompt";

export default async function BillingPage() {
  const { tenantSlug } = await requireRole("owner");

  if (isSingleMode()) {
    return (
      <SettingsPageShell
        title="Payments"
        description="Charges go to your Stripe account."
      >
        <SelfHostedPaymentsCard
          configured={Boolean(process.env.STRIPE_SECRET_KEY)}
          webhookUrl={`${getBaseUrl()}/api/stripe/webhook`}
        />
      </SettingsPageShell>
    );
  }

  const slug = tenantSlug ?? (await getTenantSlug());

  const [status, feePreview, billingSettings, policy, onboardingState] =
    await Promise.all([
      getConnectStatus(),
      getPlatformFeePreview().catch(() => null),
      getPlatformBillingSettings().catch(() => null),
      getBusinessSettings(),
      getOnboardingState(slug),
    ]);

  const billingEnabled = billingSettings?.billingEnabled ?? false;

  // Re-offer card-on-file only for salons that skipped Stripe during setup (which
  // forced the requirement off) and have since connected a charge-ready account.
  const showCardOnFilePrompt =
    status.connected &&
    status.chargesEnabled &&
    policy.requireCardOnFile === 0 &&
    onboardingState?.stripeSkipped === true;

  return (
    <SettingsPageShell
      title="Billing & Payouts"
      description="Connect your Stripe account to accept payments and receive payouts."
    >
      {feePreview ? (
        <PlatformFeePreviewCard preview={feePreview} billed={billingEnabled} />
      ) : null}
      {billingEnabled && billingSettings ? (
        <PlatformBillingCard settings={billingSettings} />
      ) : null}
      {showCardOnFilePrompt ? <CardOnFilePrompt /> : null}
      <BillingStatus status={status} />
    </SettingsPageShell>
  );
}
