import { getT } from "@/lib/terms/server";
import { requireModule } from "@/lib/tenant/modules";
import { listServiceAreas, getArrivalWindow } from "@/actions/on-site";
import { listStaff } from "@/actions/staff";
import { ServiceAreasClient } from "./client";

export default async function ServiceAreasPage() {
  await requireModule("on_site");
  const t = await getT("settings");
  const [areas, arrivalWindowMin, staff] = await Promise.all([
    listServiceAreas(),
    getArrivalWindow(),
    listStaff(),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("onSite.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("onSite.subtitle")}</p>
      </div>
      <ServiceAreasClient
        initialAreas={areas}
        arrivalWindowMin={arrivalWindowMin}
        staff={staff
          .filter((s) => s.role !== "assistant")
          .map((s) => ({ id: s.id, displayName: s.displayName }))}
      />
    </div>
  );
}
