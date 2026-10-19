"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema/tenants";
import { AuthError, requireRole } from "@/lib/auth/rbac";
import { isToggleModule } from "@/lib/modules/catalog";
import { trackEvent } from "@/lib/analytics/events";
import { getT } from "@/lib/terms/server";

export async function setModuleEnabled(
  moduleId: string,
  enabled: boolean,
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;

  if (!isToggleModule(moduleId)) {
    const t = await getT("errors", slug);
    return { success: false, error: t("modules.unknown") };
  }

  await publicDb
    .update(tenants)
    .set({
      modules: enabled
        ? sql`CASE WHEN ${tenants.modules} @> jsonb_build_array(${moduleId}::text) THEN ${tenants.modules} ELSE ${tenants.modules} || jsonb_build_array(${moduleId}::text) END`
        : sql`${tenants.modules} - ${moduleId}::text`,
      updatedAt: new Date(),
    })
    .where(eq(tenants.slug, slug));

  trackEvent("module.toggled", { moduleId, enabled }, { tenantSlug: slug });
  revalidatePath("/", "layout");
  return { success: true };
}
