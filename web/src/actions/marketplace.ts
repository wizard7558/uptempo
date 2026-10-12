"use server";

import { eq } from "drizzle-orm";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";

/** Whether the current salon is listed in the public client app marketplace. */
export async function getMarketplaceListing(): Promise<boolean> {
  const { tenantSlug: slug } = await requireStaff();
  const [row] = await publicDb
    .select({ listed: tenants.listedInMarketplace })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  return (row?.listed ?? 0) === 1;
}

/** Owner-only: opt this salon in/out of the public client app marketplace. */
export async function setMarketplaceListing(
  enabled: boolean,
): Promise<{ success: true }> {
  const session = await requireRole("owner");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = session.tenantSlug;
  await publicDb
    .update(tenants)
    .set({ listedInMarketplace: enabled ? 1 : 0, updatedAt: new Date() })
    .where(eq(tenants.slug, slug));
  return { success: true };
}
