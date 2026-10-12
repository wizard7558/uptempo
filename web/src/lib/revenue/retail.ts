import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";

/** Storefront sales (paid or fulfilled orders) created within the range. */
export async function loadRetailRevenue(
  slug: string,
  range: { start: Date; end: Date },
): Promise<{ salesCents: number; orderCount: number }> {
  return withTenantDb(slug, async (db, { orders }) => {
    const [row] = await db
      .select({
        salesCents: sql<number>`COALESCE(SUM(${orders.subtotalCents}), 0)::int`,
        orderCount: sql<number>`COUNT(*)::int`,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, ["paid", "fulfilled"]),
          gte(orders.createdAt, range.start),
          lte(orders.createdAt, range.end),
        ),
      );
    return {
      salesCents: row?.salesCents ?? 0,
      orderCount: row?.orderCount ?? 0,
    };
  });
}
