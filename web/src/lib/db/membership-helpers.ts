import { eq, and } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { memberships } from "@/lib/db/schema/memberships";
import { user } from "@/lib/db/schema/auth";
import { normalizeTeamRole } from "@/lib/auth/permissions";

/**
 * Insert a membership row. Caller must ensure no duplicate (user, tenant).
 */
export async function insertMembership(
  userId: string,
  tenantSlug: string,
  role: string,
): Promise<void> {
  await publicDb.insert(memberships).values({
    userId,
    tenantSlug,
    role,
  });
}

/**
 * Keep `user.tenant_slug` and `user.role` in sync with the active business (denormalized cache).
 */
export async function setActiveTenantForUser(
  userId: string,
  tenantSlug: string,
  role: string,
): Promise<void> {
  await publicDb
    .update(user)
    .set({ tenantSlug, role, updatedAt: new Date() })
    .where(eq(user.id, userId));
}

/**
 * Add membership and set this tenant as the user's active context.
 */
export async function addMembershipAndActivate(
  userId: string,
  tenantSlug: string,
  role: string,
): Promise<void> {
  await insertMembership(userId, tenantSlug, role);
  await setActiveTenantForUser(userId, tenantSlug, role);
}

/**
 * Resolve team role for the user's currently selected tenant (`user.tenant_slug`).
 */
export async function getMembershipRoleForActiveTenant(
  userId: string,
  tenantSlug: string | null,
): Promise<string | null> {
  if (!tenantSlug?.trim()) return null;
  const [row] = await publicDb
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.tenantSlug, tenantSlug.trim()),
      ),
    )
    .limit(1);
  return row ? normalizeTeamRole(row.role) : null;
}
