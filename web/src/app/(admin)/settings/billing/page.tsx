import { requireRole } from "@/lib/auth/rbac";
import { getConnectStatus } from "@/actions/connect";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { BillingStatus } from "./billing-status";
import { getHostedPlan } from "@/actions/hosted-billing";
import { getBusinessSettings } from "@/actions/policies";
import { getOnboardingState } from "@/actions/onboarding";
import { isSingleMode } from "@/lib/config/mode";
import { getTenantSlug } from "@/lib/tenant/context";
import { getBaseUrl } from "@/lib/utils";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { HostedPlanCard } from "@/components/settings/hosted-plan-card";
import { getTerms } from "@/lib/terms/server";
import { SelfHostedPaymentsCard } from "@/components/settings/self-hosted-payments-card";
import { CardOnFilePrompt } from "@/components/settings/card-on-file-prompt";
import { BillingSwitchNotice } from "@/components/settings/billing-switch-notice";

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

  const [status, plan, policy, onboardingState, tenant, terms] =
    await Promise.all([
      getConnectStatus(),
      getHostedPlan().catch(() => null),
      getBusinessSettings(),
      getOnboardingState(slug),
      getTenantBySlug(slug),
      getTerms(slug),
    ]);

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
      {tenant?.comped === 1 ? null : (
        <BillingSwitchNotice
          noticeSentAt={tenant?.billingNoticeSentAt ?? null}
          switchAt={tenant?.billingSwitchAt ?? null}
        />
      )}
      <HostedPlanCard plan={plan} terms={terms} timezone={tenant?.timezone} />
      {showCardOnFilePrompt ? <CardOnFilePrompt /> : null}
      <BillingStatus status={status} />
    </SettingsPageShell>
  );
}
