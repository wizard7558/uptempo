"use server";

import { TZDate } from "@date-fns/tz";
import {
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { withTenantDb } from "@/lib/db/tenant";
import {
  createExpenseSchema,
  expenseFiltersSchema,
  updateExpenseSchema,
} from "@/lib/validators/expense";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { getT } from "@/lib/terms/server";
import {
  buildCategoryTotals,
  type ExpenseCategoryRow,
} from "@/lib/expenses/categories";
import {
  ensureExpenseCategories,
  listExpenseCategoryRows,
} from "@/lib/expenses/seed";
import { trackEvent } from "@/lib/analytics/events";

async function authorize(): Promise<string> {
  const { tenantSlug } = await requireRole("owner", "admin");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  return tenantSlug;
}

const unknownCategoryResult = async (slug: string) => ({
  success: false as const,
  error: {
    formErrors: [],
    fieldErrors: {},
    message: (await getT("errors", slug))("expenses.unknownCategory"),
  },
});

/** A category is valid when it exists and is shown, or (on update) it is the expense's current one. */
async function isCategoryAllowed(
  slug: string,
  category: string,
  currentCategory?: string,
): Promise<boolean> {
  return withTenantDb(slug, async (db, { expenseCategories }) => {
    const [row] = await db
      .select({ isActive: expenseCategories.isActive })
      .from(expenseCategories)
      .where(eq(expenseCategories.slug, category))
      .limit(1);
    if (!row) return false;
    return row.isActive === 1 || category === currentCategory;
  });
}

async function getTenantTimezone(slug: string) {
  const [policy] = await withTenantDb(slug, async (db, { businessSettings }) => {
    return db
      .select({ timezone: businessSettings.timezone })
      .from(businessSettings)
      .limit(1);
  });

  return policy?.timezone ?? "America/New_York";
}

async function getExpenseSummaryForRange(
  slug: string,
  categories: ExpenseCategoryRow[],
  startDate: string,
  endDate: string,
) {
  const rows = await withTenantDb(slug, async (db, { expenses }) => {
    return db
      .select({
        category: expenses.category,
        totalCents:
          sql<number>`COALESCE(SUM(${expenses.amountCents}), 0)::int`.as(
            "total_cents",
          ),
      })
      .from(expenses)
      .where(
        and(
          gte(expenses.expenseDate, startDate),
          lte(expenses.expenseDate, endDate),
        ),
      )
      .groupBy(expenses.category)
      .orderBy(asc(expenses.category));
  });

  const byCategory = buildCategoryTotals(
    categories,
    new Map(rows.map((row) => [row.category, row.totalCents])),
  );
  return {
    startDate,
    endDate,
    totalCents: byCategory.reduce((sum, row) => sum + row.totalCents, 0),
    byCategory,
  };
}

export async function getExpenseDashboard(filters: {
  startDate?: string;
  endDate?: string;
  category?: string | "all";
} = {}) {
  await requireStaff();
  const slug = await authorize();
  await ensureExpenseCategories(slug);
  const categories = await listExpenseCategoryRows(slug, { includeHidden: true });
  const parsed = expenseFiltersSchema.safeParse(filters);
  if (!parsed.success) {
    return {
      expenses: [],
      totals: {
        totalCents: 0,
        count: 0,
        byCategory: buildCategoryTotals(categories, new Map()),
      },
      currentWeek: {
        totalCents: 0,
        byCategory: buildCategoryTotals(categories, new Map()),
      },
      currentMonth: {
        totalCents: 0,
        byCategory: buildCategoryTotals(categories, new Map()),
      },
      filters: {
        startDate: null,
        endDate: null,
        category: "all" as const,
      },
      categories,
    };
  }

  const timezone = await getTenantTimezone(slug);
  const today = new TZDate(new Date(), timezone);
  const currentWeekRange = {
    startDate: format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    endDate: format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"),
  };
  const currentMonthRange = {
    startDate: format(startOfMonth(today), "yyyy-MM-dd"),
    endDate: format(endOfMonth(today), "yyyy-MM-dd"),
  };

  const { startDate, endDate, category } = parsed.data;

  const expenses = await withTenantDb(slug, async (db, { expenses }) => {
    const conditions = [];

    if (startDate) conditions.push(gte(expenses.expenseDate, startDate));
    if (endDate) conditions.push(lte(expenses.expenseDate, endDate));
    if (category && category !== "all") {
      conditions.push(eq(expenses.category, category));
    }

    return db
      .select({
        id: expenses.id,
        expenseDate: expenses.expenseDate,
        vendorName: expenses.vendorName,
        category: expenses.category,
        amountCents: expenses.amountCents,
        createdAt: expenses.createdAt,
        updatedAt: expenses.updatedAt,
      })
      .from(expenses)
      .where(conditions.length > 0 ? and(...conditions) : sql`TRUE`)
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));
  });

  const totalsMap = new Map<string, number>();
  for (const expense of expenses) {
    totalsMap.set(
      expense.category,
      (totalsMap.get(expense.category) ?? 0) + expense.amountCents,
    );
  }

  const filteredTotals = buildCategoryTotals(categories, totalsMap);

  const [currentWeek, currentMonth] = await Promise.all([
    getExpenseSummaryForRange(
      slug,
      categories,
      currentWeekRange.startDate,
      currentWeekRange.endDate,
    ),
    getExpenseSummaryForRange(
      slug,
      categories,
      currentMonthRange.startDate,
      currentMonthRange.endDate,
    ),
  ]);

  return {
    expenses,
    totals: {
      totalCents: expenses.reduce((sum, expense) => sum + expense.amountCents, 0),
      count: expenses.length,
      byCategory: filteredTotals,
    },
    currentWeek,
    currentMonth,
    filters: {
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      category: category ?? "all",
    },
    categories,
  };
}

export async function createExpense(data: {
  expenseDate: string;
  vendorName: string;
  category: string;
  amountCents: number;
}) {
  await requireStaff();
  const parsed = createExpenseSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  const slug = await authorize();
  await ensureExpenseCategories(slug);
  if (!(await isCategoryAllowed(slug, parsed.data.category))) {
    return unknownCategoryResult(slug);
  }

  try {
    const [expense] = await withTenantDb(slug, async (db, { expenses }) => {
      return db
        .insert(expenses)
        .values({
          expenseDate: parsed.data.expenseDate,
          vendorName: parsed.data.vendorName,
          category: parsed.data.category,
          amountCents: parsed.data.amountCents,
        })
        .returning({
          id: expenses.id,
        });
    });

    revalidatePath("/expenses");
    revalidatePath("/analytics/services");
    trackEvent(
      "expense.created",
      {
        category: parsed.data.category,
        amountCents: parsed.data.amountCents,
      },
      { tenantSlug: slug },
    );
    return { success: true as const, id: expense.id };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to create expense",
      },
    };
  }
}

export async function updateExpense(data: {
  id: string;
  expenseDate: string;
  vendorName: string;
  category: string;
  amountCents: number;
}) {
  await requireStaff();
  const parsed = updateExpenseSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  const slug = await authorize();
  await ensureExpenseCategories(slug);
  const current = await withTenantDb(slug, async (db, { expenses }) => {
    const [row] = await db
      .select({ category: expenses.category })
      .from(expenses)
      .where(eq(expenses.id, parsed.data.id))
      .limit(1);
    return row?.category;
  });
  if (!(await isCategoryAllowed(slug, parsed.data.category, current))) {
    return unknownCategoryResult(slug);
  }

  try {
    const result = await withTenantDb(slug, async (db, { expenses }) => {
      return db
        .update(expenses)
        .set({
          expenseDate: parsed.data.expenseDate,
          vendorName: parsed.data.vendorName,
          category: parsed.data.category,
          amountCents: parsed.data.amountCents,
          updatedAt: new Date(),
        })
        .where(eq(expenses.id, parsed.data.id))
        .returning({ id: expenses.id });
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Expense not found",
        },
      };
    }

    revalidatePath("/expenses");
    revalidatePath("/analytics/services");
    trackEvent(
      "expense.updated",
      {
        category: parsed.data.category,
        amountCents: parsed.data.amountCents,
      },
      { tenantSlug: slug },
    );
    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to update expense",
      },
    };
  }
}

export async function deleteExpense(id: string) {
  await requireStaff();
  const slug = await authorize();
  try {
    const result = await withTenantDb(slug, async (db, { expenses }) => {
      return db
        .delete(expenses)
        .where(eq(expenses.id, id))
        .returning({ id: expenses.id });
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: { message: "Expense not found" },
      };
    }

    revalidatePath("/expenses");
    revalidatePath("/analytics/services");
    trackEvent("expense.deleted", { expenseId: id }, { tenantSlug: slug });
    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: { message: "Failed to delete expense" },
    };
  }
}
