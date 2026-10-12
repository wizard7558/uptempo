import { listAftercareTemplates } from "@/actions/aftercare";
import { listServices } from "@/actions/services";
import { AftercarePageClient } from "./client";
import { requireModule } from "@/lib/tenant/modules";

export default async function AftercareSettingsPage() {
  await requireModule("aftercare");
  const [templates, services] = await Promise.all([
    listAftercareTemplates(),
    listServices(),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Aftercare Instructions</h1>
        <p className="text-muted-foreground mt-1">
          Create aftercare templates that are automatically sent to clients
          after their appointments are completed.
        </p>
      </div>

      <AftercarePageClient
        initialTemplates={templates}
        availableServices={services.map((s) => ({ id: s.id, name: s.name }))}
      />
    </div>
  );
}
