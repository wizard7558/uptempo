import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ManageBillingButton } from "@/components/settings/manage-billing-button";
import type { HostedPlan } from "@/actions/hosted-billing";
import { isSingleMode } from "@/lib/config/mode";
import { formatCurrency } from "@/lib/format";
import { createTermsT } from "@/lib/terms/translator";
import type { VerticalTerms } from "@/lib/verticals";

const TEXT_LINE_KEYS = {
  off: "textLineOff",
  shared: "textLineShared",
  pending: "textLinePending",
  action_needed: "textLineActionNeeded",
  active: "textLineActive",
} as const;

export function HostedPlanCard({
  plan,
  terms,
  timezone,
}: {
  plan: HostedPlan | null;
  terms: VerticalTerms;
  timezone?: string;
}) {
  if (isSingleMode() || !plan) return null;
  const t = createTermsT(terms, "settings.billing");

  if (plan.comped) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("planTitle")}</CardTitle>
          <CardDescription>{t("planComped")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("cardProcessingNone")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const trialDate = plan.trialEndsAt
    ? new Date(plan.trialEndsAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: timezone,
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("planTitle")}</CardTitle>
        <CardDescription>
          {t("planStaffLine", {
            count: plan.billableStaff,
            price: formatCurrency(plan.monthlyCents),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {trialDate ? <p>{t("freeUntil", { date: trialDate })}</p> : null}
        <p>
          {t("textLine", { status: t(TEXT_LINE_KEYS[plan.smsLineStatus]) })}
        </p>
        <p>{t("chargesHeader", { label: plan.processingLabel })}</p>
        <p className="text-muted-foreground">{t("cardProcessingHint")}</p>
        {plan.hasBillingAccount ? (
          <ManageBillingButton
            label={t("manageBilling")}
            nativeNotice={t("nativePlatformBilling")}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
