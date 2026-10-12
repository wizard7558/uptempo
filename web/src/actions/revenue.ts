"use server";

import { AuthError, requireRole } from "@/lib/auth/rbac";
import { hasModule } from "@/lib/tenant/modules";
import { loadRetailRevenue } from "@/lib/revenue/retail";
import { getStaffRevenue } from "@/actions/checkout";

export type StaffRevenueRow = Awaited<
  ReturnType<typeof getStaffRevenue>
>[number];
export type RevenueReport = {
  staff: StaffRevenueRow[];
  retail: { salesCents: number; orderCount: number } | null;
};

/** Revenue by staff plus storefront sales. Owner/admin only. */
export async function getRevenueReport(range: {
  start: Date;
  end: Date;
}): Promise<RevenueReport> {
  const { tenantSlug } = await requireRole("owner", "admin");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;

  const [staff, storefrontOn, retail] = await Promise.all([
    getStaffRevenue(range),
    hasModule(slug, "storefront"),
    loadRetailRevenue(slug, range),
  ]);

  return {
    staff,
    retail: storefrontOn || retail.salesCents > 0 ? retail : null,
  };
}
