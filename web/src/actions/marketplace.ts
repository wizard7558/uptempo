"use server";

import { eq } from "drizzle-orm";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { isSingleMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";

/** Whether the current business is listed in the public client app marketplace. */
export async function getMarketplaceListing(): Promise<boolean> {
  const { tenantSlug: slug } = await requireStaff();
  if (isSingleMode()) return false;

  const [row] = await publicDb
    .select({ listed: tenants.listedInMarketplace })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return (row?.listed ?? 0) === 1;
}

/** Owner-only: opt this business in/out of the public client app marketplace. */
export async function setMarketplaceListing(
  enabled: boolean,
): Promise<{ success: true }> {
  const session = await requireRole("owner");
  if (isSingleMode()) throw new Error("Not available on this install.");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = session.tenantSlug;
  await publicDb
    .update(tenants)
    .set({ listedInMarketplace: enabled ? 1 : 0, updatedAt: new Date() })
    .where(eq(tenants.slug, slug));
  return { success: true };
}
