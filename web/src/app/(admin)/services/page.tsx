import { listServices, listAvailablePresets, getAllServiceNeeds } from "@/actions/services";
import { listResources } from "@/actions/resources";
import { listTaskTypes } from "@/actions/task-catalog";
import { getStaffOfferingCounts } from "@/actions/staff-services";
import { listServiceCategories } from "@/actions/service-categories";
import { getAllServiceAddonsMap } from "@/actions/service-addons";
import { getT } from "@/lib/terms/server";
import { getTenantSlug } from "@/lib/tenant/context";
import { hasModule } from "@/lib/tenant/modules";
import { ServiceList } from "./service-list";

export default async function ServicesPage() {
  const slug = await getTenantSlug();
  const [assistantEnabled, classesEnabled] = await Promise.all([
    hasModule(slug, "assistant_tasks"),
    hasModule(slug, "classes"),
  ]);
  const [
    services,
    taskTypes,
    offeringCounts,
    availablePresets,
    categories,
    addonsByService,
    resources,
    needsByService,
  ] = await Promise.all([
    listServices(),
    assistantEnabled
      ? listTaskTypes().catch(() => [] as { id: string; name: string }[])
      : Promise.resolve([]),
    getStaffOfferingCounts(),
    listAvailablePresets(),
    listServiceCategories(),
    getAllServiceAddonsMap(),
    listResources(),
    getAllServiceNeeds(),
  ]);

  const t = await getT("schedule", slug);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Services</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("servicesPage.subtitle")}
        </p>
      </div>

      <ServiceList
        initialServices={services.map((s) => ({
          ...s,
          priceDisplay: (s.priceDisplay as "show" | "starting" | "hidden") ?? "show",
          bookingAudience:
            (s.bookingAudience as "all" | "new" | "returning") ?? "all",
          depositType:
            (s.depositType as "none" | "percent" | "fixed" | null) ?? null,
          locationType:
            (s.locationType as "in_studio" | "virtual" | "on_site") ?? "in_studio",
        }))}
        assistantSettingsEnabled={assistantEnabled}
        taskTypes={taskTypes.map((t) => ({ id: t.id, name: t.name }))}
        offeringCounts={offeringCounts}
        availablePresets={availablePresets}
        categories={categories.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
        }))}
        addonsByService={addonsByService}
        resources={resources
          .filter((r) => r.isActive === 1)
          .map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
        needsByService={needsByService}
        classesEnabled={classesEnabled}
      />
    </div>
  );
}
