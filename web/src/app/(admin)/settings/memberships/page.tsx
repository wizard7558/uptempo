import Link from "next/link";
import { getT } from "@/lib/terms/server";
import { ArrowLeft } from "lucide-react";
import { MembershipPlansManager } from "@/components/membership/membership-plans-manager";
import { StoredValueExpirySettings } from "@/components/membership/stored-value-expiry-settings";
import { MembershipOverview } from "@/components/membership/membership-overview";
import {
  listMembershipPlans,
  getStoredValueExpiryMonths,
  listActiveMemberships,
} from "@/actions/membership";
import { listServices } from "@/actions/services";

export default async function MembershipsSettingsPage() {
  const t = await getT("settings");
  const [plans, expiryMonths, overview, services] = await Promise.all([
    listMembershipPlans(),
    getStoredValueExpiryMonths(),
    listActiveMemberships(),
    listServices(),
  ]);

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to settings
      </Link>
      <div>
        <h1 className="text-2xl font-bold">{t("membershipsPage.title")}</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          {t("membershipsPage.subtitle")}
        </p>
      </div>
      <MembershipOverview
        memberships={overview.memberships}
        mrrCents={overview.mrrCents}
        count={overview.count}
      />
      <MembershipPlansManager
        initialPlans={plans}
        services={services.map((sv) => ({ id: sv.id, name: sv.name }))}
      />
      <StoredValueExpirySettings initialMonths={expiryMonths} />
    </div>
  );
}
