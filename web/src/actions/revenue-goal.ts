"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withTenantDb } from "@/lib/db/tenant";
import { getUserRole, requireStaff } from "@/lib/auth/rbac";
import { hasPermission } from "@/lib/auth/permissions";
import { getBusinessSettingsForTenant } from "@/lib/policies/salon-policy";

/**
 * Salon-wide monthly service-revenue goal (cents). Stored on salon_policies;
 * NULL means no goal set. Reading is gated to roles that can view revenue;
 * writing is gated to settings managers (owner/admin).
 */

/** Current monthly revenue goal in cents, or null when unset. */
export async function getMonthlyRevenueGoal(): Promise<number | null> {
  const { tenantSlug: slug } = await requireStaff();
  const role = await getUserRole();
  if (!role || !hasPermission(role, "view_revenue")) {
    throw new Error("Unauthorized");
  }
  const policy = await getBusinessSettingsForTenant(slug);
  return policy.monthlyRevenueGoalCents ?? null;
}

/**
 * Set (or clear, with null) the salon's monthly revenue goal in cents.
 * Rejects non-integer or negative amounts.
 */
export async function setMonthlyRevenueGoal(
  cents: number | null,
): Promise<{ success: boolean; message?: string }> {
  const { tenantSlug: slug } = await requireStaff();
  const role = await getUserRole();
  if (!role || !hasPermission(role, "manage_settings")) {
    return { success: false, message: "Unauthorized" };
  }

  if (cents !== null) {
    if (!Number.isInteger(cents) || cents < 0) {
      return { success: false, message: "Goal must be a whole, non-negative amount" };
    }
  }

  try {
    // Ensure a policy row exists before updating.
    const policy = await getBusinessSettingsForTenant(slug);

    await withTenantDb(slug, async (db, { businessSettings }) => {
      await db
        .update(businessSettings)
        .set({ monthlyRevenueGoalCents: cents, updatedAt: new Date() })
        .where(eq(businessSettings.id, policy.id));
    });

    revalidatePath("/analytics");
    return { success: true };
  } catch (e) {
    console.error("setMonthlyRevenueGoal", e);
    return { success: false, message: "Could not update revenue goal" };
  }
}
