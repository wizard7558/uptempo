import { listCustomFieldDefinitions } from "@/actions/custom-fields";
import { requireRole } from "@/lib/auth/rbac";
import type { FieldEntity } from "@/lib/custom-fields/values";
import { hasModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { redirect } from "next/navigation";
import { CustomFieldsClient } from "./custom-fields-client";

export default async function CustomFieldsSettingsPage() {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) redirect("/login");
  const t = await getT("customFields", auth.tenantSlug);
  const fields = await listCustomFieldDefinitions(undefined, { includeInactive: true });
  const [projectsOn, requestsOn] = await Promise.all([
    hasModule(auth.tenantSlug, "projects"),
    hasModule(auth.tenantSlug, "requests"),
  ]);

  const sections: { entity: FieldEntity; title: string }[] = [
    { entity: "client", title: t("sections.client") },
    { entity: "appointment", title: t("sections.appointment") },
  ];
  if (projectsOn) sections.push({ entity: "project", title: t("sections.project") });
  if (requestsOn) sections.push({ entity: "request", title: t("sections.request") });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("settings.subtitle")}</p>
      </div>
      <CustomFieldsClient
        sections={sections.map((section) => ({
          ...section,
          fields: fields.filter((field) => field.entity === section.entity),
        }))}
      />
    </div>
  );
}
