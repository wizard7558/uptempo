import { listChecklistTemplates } from "@/actions/checklists";
import { requireRole } from "@/lib/auth/rbac";
import { getT } from "@/lib/terms/server";
import { requireModule } from "@/lib/tenant/modules";
import { ChecklistsClient } from "./checklists-client";

export default async function ChecklistsSettingsPage() {
  await requireRole("owner", "admin");
  await requireModule("attachments");
  const t = await getT("appointmentWork");
  const templates = await listChecklistTemplates();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("settings.subtitle")}</p>
      </div>
      <ChecklistsClient templates={templates} />
    </div>
  );
}
