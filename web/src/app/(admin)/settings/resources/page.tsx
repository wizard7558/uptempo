import { getT } from "@/lib/terms/server";
import { listResources } from "@/actions/resources";
import { listActiveLocations } from "@/actions/locations";
import { ResourcesClient } from "./client";

export default async function ResourcesPage() {
  const t = await getT("settings");
  const [resources, locations] = await Promise.all([listResources(), listActiveLocations()]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("resources.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("resources.subtitle")}</p>
      </div>
      <ResourcesClient
        initialResources={resources}
        locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      />
    </div>
  );
}
