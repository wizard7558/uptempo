import { getT } from "@/lib/terms/server";
import { getBusinessSettings } from "@/actions/policies";
import { PolicyForm } from "@/components/settings/policy-form";
import { getTenantSlug } from "@/lib/tenant/context";

export default async function PoliciesPage() {
  const slug = await getTenantSlug();
  const t = await getT("settings", slug);
  const policy = await getBusinessSettings();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Policies</h1>
        <p className="text-muted-foreground mt-1">
          {t("policiesPage.subtitle")}
        </p>
      </div>

      <PolicyForm
        initialPolicy={{
          cancellationWindowHours: policy.cancellationWindowHours,
          cancellationFeePercent: policy.cancellationFeePercent,
          noShowFeePercent: policy.noShowFeePercent,
          requireCardOnFile: policy.requireCardOnFile,
          policyText: policy.policyText,
          onlineBookingAudience: (policy.onlineBookingAudience ??
            "both") as "both" | "existing_only" | "new_only",
          depositEnabled: policy.depositEnabled ?? 0,
          depositDefaultType: (policy.depositDefaultType ?? "percent") as
            | "percent"
            | "fixed",
          depositDefaultAmount: policy.depositDefaultAmount ?? 0,
          depositDurationThresholdMinutes:
            policy.depositDurationThresholdMinutes ?? null,
        }}
      />
    </div>
  );
}
