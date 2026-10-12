import { getT } from "@/lib/terms/server";
import { requireModule } from "@/lib/tenant/modules";
import { listPackages } from "@/actions/packages";
import { listServices } from "@/actions/services";
import { PackagesClient } from "./client";

export default async function PackagesSettingsPage() {
  await requireModule("packages");
  const t = await getT("packages");
  const [packs, services] = await Promise.all([listPackages(), listServices()]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>
      <PackagesClient
        initialPacks={packs}
        services={services.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
