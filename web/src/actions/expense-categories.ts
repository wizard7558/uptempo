"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { withTenantDb } from "@/lib/db/tenant";
import { getT } from "@/lib/terms/server";
import {
  expenseCategorySlug,
  type ExpenseCategoryRow,
} from "@/lib/expenses/categories";
import {
  ensureExpenseCategories,
  listExpenseCategoryRows,
} from "@/lib/expenses/seed";

type Result = { success: true } | { success: false; error: string };

const nameSchema = z.string().trim().min(1).max(40);

async function authorize(): Promise<string> {
  const { tenantSlug } = await requireRole("owner", "admin");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;
  await ensureExpenseCategories(slug);
  return slug;
}

function refresh() {
  revalidatePath("/expenses");
  revalidatePath("/analytics/services");
}

/** All categories for this business, hidden ones included. */
export async function listExpenseCategories(): Promise<ExpenseCategoryRow[]> {
  await requireStaff();
  const slug = await authorize();
  return listExpenseCategoryRows(slug, { includeHidden: true });
}

export async function createExpenseCategory(data: { name: string }): Promise<Result> {
  await requireStaff();
  const slug = await authorize();
  const te = await getT("expenses", slug);
  const parsed = nameSchema.safeParse(data.name);
  const categorySlug = parsed.success ? expenseCategorySlug(parsed.data) : "";
  if (!parsed.success || !categorySlug) {
    return { success: false, error: te("categories.nameRequired") };
  }

  const created = await withTenantDb(slug, async (db, { expenseCategories }) => {
    const [existing] = await db
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(eq(expenseCategories.slug, categorySlug))
      .limit(1);
    if (existing) return false;
    const [{ max }] = await db
      .select({ max: sql<number>`COALESCE(MAX(${expenseCategories.sortOrder}), 0)::int` })
      .from(expenseCategories);
    await db.insert(expenseCategories).values({
      slug: categorySlug,
      name: parsed.data,
      sortOrder: max + 10,
      isDefault: 0,
    });
    return true;
  });

  if (!created) {
    const terr = await getT("errors", slug);
    return { success: false, error: terr("expenses.categoryExists") };
  }
  refresh();
  return { success: true };
}

export async function renameExpenseCategory(data: {
  id: string;
  name: string;
}): Promise<Result> {
  await requireStaff();
  const slug = await authorize();
  const te = await getT("expenses", slug);
  const parsed = nameSchema.safeParse(data.name);
  if (!parsed.success) {
    return { success: false, error: te("categories.nameRequired") };
  }
  await withTenantDb(slug, async (db, { expenseCategories }) => {
    await db
      .update(expenseCategories)
      .set({ name: parsed.data, updatedAt: new Date() })
      .where(eq(expenseCategories.id, data.id));
  });
  refresh();
  return { success: true };
}

export async function setExpenseCategoryActive(data: {
  id: string;
  active: boolean;
}): Promise<Result> {
  await requireStaff();
  const slug = await authorize();
  const te = await getT("expenses", slug);

  const outcome = await withTenantDb(slug, async (db, { expenseCategories }) => {
    const [row] = await db
      .select({ slug: expenseCategories.slug })
      .from(expenseCategories)
      .where(eq(expenseCategories.id, data.id))
      .limit(1);
    if (!row) return "missing" as const;
    if (!data.active && row.slug === "other") return "protected" as const;
    await db
      .update(expenseCategories)
      .set({ isActive: data.active ? 1 : 0, updatedAt: new Date() })
      .where(eq(expenseCategories.id, data.id));
    return "ok" as const;
  });

  if (outcome !== "ok") {
    return { success: false, error: te("categories.failed") };
  }
  refresh();
  return { success: true };
}
