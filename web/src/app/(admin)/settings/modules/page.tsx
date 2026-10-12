import { requireRole } from "@/lib/auth/rbac";
import { getTenantSlug } from "@/lib/tenant/context";
import { getModuleRows } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { ModulesSettingsClient } from "./client";

export default async function ModulesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ off?: string }>;
}) {
  await requireRole("owner", "admin");
  const { off } = await searchParams;
  const slug = await getTenantSlug();
  const [{ industryLabel, rows }, t] = await Promise.all([
    getModuleRows(slug),
    getT("modules", slug),
  ]);

  return (
    <SettingsPageShell title={t("page.title")} description={t("page.subtitle")}>
      <ModulesSettingsClient rows={rows} industryLabel={industryLabel} offId={off} />
    </SettingsPageShell>
  );
}
