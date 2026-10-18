import { and, eq, sql } from "drizzle-orm";
import { syncHostedSubscription } from "@/lib/billing/subscriptions";
import { isSingleMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { withTenantDb } from "@/lib/db/tenant";

/** Active providers are billable; assistants are free (D1). */
export async function countBillableStaff(slug: string): Promise<number> {
  return withTenantDb(slug, async (db, { staff }) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(staff)
      .where(and(eq(staff.role, "provider"), eq(staff.isActive, 1)));
    return row?.count ?? 0;
  });
}

/**
 * Recount billable staff and, when the number changed, store it on the tenant
 * and push the new quantity to Stripe. Never throws: a Stripe or DB failure
 * must not fail a staff edit, and the nightly reconcile (6.1d) catches up.
 */
export async function syncBillableStaff(slug: string): Promise<void> {
  if (isSingleMode()) return;
  try {
    const count = await countBillableStaff(slug);
    const [tenant] = await publicDb
      .select({ billableStaff: tenants.billableStaff })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (!tenant || tenant.billableStaff === count) return;
    await publicDb
      .update(tenants)
      .set({ billableStaff: count })
      .where(eq(tenants.slug, slug));
    await syncHostedSubscription(slug);
  } catch (error) {
    console.error("[billing] syncBillableStaff failed", slug, error);
  }
}
