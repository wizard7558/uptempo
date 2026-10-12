import { getT } from "@/lib/terms/server";
import { listStaff } from "@/actions/staff";
import { getTenantSlug } from "@/lib/tenant/context";
import { hasModule } from "@/lib/tenant/modules";
import { StaffPageClient } from "./client";
import { CapacityGoalsCard } from "@/components/settings/capacity-goals-card";

export default async function StaffPage() {
  const t = await getT("settings");
  const [staff, onSiteEnabled] = await Promise.all([
    listStaff(),
    getTenantSlug().then((slug) => hasModule(slug, "on_site")),
  ]);

  const assistants = staff
    .filter((s) => s.role === "assistant")
    .map((s) => ({ id: s.id, displayName: s.displayName }));

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("staffPage.title")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("staffPage.subtitle")}
        </p>
      </div>

      <StaffPageClient initialStaff={staff.map((s) => ({
          ...s,
          booksMode: s.booksMode as "open" | "windows" | "closed",
        }))} assistants={assistants} onSiteEnabled={onSiteEnabled} />

      <CapacityGoalsCard
        staff={staff.map((s) => ({
          id: s.id,
          displayName: s.displayName,
          targetHoursPerWeek: s.targetHoursPerWeek ?? null,
          targetHourlyEarningsCents: s.targetHourlyEarningsCents ?? null,
        }))}
      />
    </div>
  );
}
