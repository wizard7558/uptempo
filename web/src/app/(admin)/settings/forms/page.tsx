import { listFormTemplates } from "@/actions/forms";
import { listServices } from "@/actions/services";
import { getBusinessSettings } from "@/actions/policies";
import { FormsPageClient } from "./client";

export default async function FormsSettingsPage() {
  const [templates, services, settings] = await Promise.all([
    listFormTemplates(),
    listServices(),
    getBusinessSettings(),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Forms & Waivers</h1>
        <p className="text-muted-foreground mt-1">
          Create form templates that are automatically sent to clients when they
          book services with assigned forms.
        </p>
      </div>

      <FormsPageClient
        initialTemplates={templates}
        availableServices={services.map((s) => ({ id: s.id, name: s.name }))}
        idRetentionDays={settings.idRetentionDays}
      />
    </div>
  );
}
