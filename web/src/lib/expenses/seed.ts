import { asc, eq, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getVertical } from "@/lib/verticals";
import {
  packExpenseCategories,
  type ExpenseCategoryRow,
} from "@/lib/expenses/categories";

/**
 * Seeds the industry pack's expense categories the first time a tenant reads
 * them (migration 0041 only backfills categories already in use). Runs when no
 * default row exists; upserts on slug so legacy rows with a matching slug are
 * marked as defaults and keep their id.
 */
export async function ensureExpenseCategories(slug: string): Promise<void> {
  const tenant = await getTenantBySlug(slug);
  const defs = packExpenseCategories(getVertical(tenant?.industry));

  await withTenantDb(slug, async (db, { expenseCategories }) => {
    const [existing] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(eq(expenseCategories.isDefault, 1))
      .limit(1);
    if (existing) return;

    await db
      .insert(expenseCategories)
      .values(
        defs.map((d, i) => ({
          slug: d.slug,
          name: d.name,
          sortOrder: (i + 1) * 10,
          isDefault: 1,
        })),
      )
      .onConflictDoUpdate({
        target: expenseCategories.slug,
        set: {
          isDefault: 1,
          sortOrder: sql`excluded.sort_order`,
          updatedAt: new Date(),
        },
      });
  });
}

export async function listExpenseCategoryRows(
  slug: string,
  opts: { includeHidden: boolean },
): Promise<ExpenseCategoryRow[]> {
  const rows = await withTenantDb(slug, async (db, { expenseCategories }) => {
    const q = db.select().from(expenseCategories);
    return (
      opts.includeHidden ? q : q.where(eq(expenseCategories.isActive, 1))
    ).orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name));
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    sortOrder: r.sortOrder,
    isDefault: r.isDefault === 1,
    isActive: r.isActive === 1,
  }));
}
