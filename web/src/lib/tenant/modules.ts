import { redirect } from "next/navigation";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { getVertical, MODULE_IDS, type ModuleId } from "@/lib/verticals";
import {
  MODULE_CATALOG,
  isModuleEnabled,
  type ModuleArea,
  type ModuleAvailability,
} from "@/lib/modules/catalog";

export class ModuleDisabledError extends Error {
  readonly moduleId: ModuleId;
  constructor(moduleId: ModuleId, message: string) {
    super(message);
    this.name = "ModuleDisabledError";
    this.moduleId = moduleId;
  }
}

export async function hasModule(slug: string, id: ModuleId): Promise<boolean> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return false;
  return isModuleEnabled(tenant.modules, id);
}

export async function getEnabledModules(slug: string): Promise<ModuleId[]> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return [];
  return MODULE_IDS.filter((id) => isModuleEnabled(tenant.modules, id));
}

/** For server actions. Throws when the module is off. */
export async function assertModule(slug: string, id: ModuleId): Promise<void> {
  if (await hasModule(slug, id)) return;
  const [t, tm] = await Promise.all([
    getT("errors", slug),
    getT("modules", slug),
  ]);
  throw new ModuleDisabledError(
    id,
    t("modules.turnedOff", { name: tm(`items.${id}.name`) }),
  );
}

/** For admin pages. Sends owners to the Features page when the module is off. */
export async function requireModule(id: ModuleId): Promise<void> {
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, id))) {
    redirect(`/settings/modules?off=${id}`);
  }
}

export type ModuleRow = {
  id: ModuleId;
  area: ModuleArea;
  availability: Exclude<ModuleAvailability, "planned">;
  enabled: boolean;
  recommended: boolean;
};

export async function getModuleRows(
  slug: string,
): Promise<{ industryLabel: string; rows: ModuleRow[] }> {
  const tenant = await getTenantBySlug(slug);
  const vertical = getVertical(tenant?.industry);
  const rows: ModuleRow[] = [];
  for (const entry of MODULE_CATALOG) {
    if (entry.availability === "planned") continue;
    rows.push({
      id: entry.id,
      area: entry.area,
      availability: entry.availability,
      enabled: isModuleEnabled(tenant?.modules, entry.id),
      recommended: vertical.modules.includes(entry.id),
    });
  }
  return { industryLabel: vertical.label, rows };
}
