import {
  HAIR_SALON_EXPENSE_CATEGORY_VALUES,
  hairSalon,
} from "@/lib/verticals/hair-salon";
import type { Vertical } from "@/lib/verticals/types";

export type ExpenseCategory =
  | "color"
  | "extensions"
  | "backbar"
  | "retail"
  | "tools_supplies"
  | "rent"
  | "utilities"
  | "subscriptions"
  | "other";

export const EXPENSE_CATEGORY_OPTIONS = hairSalon.expenseCategories.map(
  (label, i) => ({
    value: HAIR_SALON_EXPENSE_CATEGORY_VALUES[i] as ExpenseCategory,
    label,
  }),
);

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> =
  EXPENSE_CATEGORY_OPTIONS.reduce(
    (acc, option) => {
      acc[option.value] = option.label;
      return acc;
    },
    {} as Record<ExpenseCategory, string>,
  );

export function formatExpenseCategory(category: string | null | undefined) {
  if (!category) return "Other";
  return EXPENSE_CATEGORY_LABELS[category as ExpenseCategory] ?? category;
}

/** A per-tenant expense category as stored in `expense_categories`. */
export type ExpenseCategoryRow = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  isActive: boolean;
};

/**
 * Stable storage key for a category label: lowercase, "&" becomes " and ",
 * runs of non-alphanumerics become "_", and edge underscores are trimmed.
 */
export function expenseCategorySlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The default categories an industry pack seeds for a new tenant. */
export function packExpenseCategories(
  v: Vertical,
): { slug: string; name: string }[] {
  if (v.id === "hair_salon") {
    return HAIR_SALON_EXPENSE_CATEGORY_VALUES.map((slug, i) => ({
      slug,
      name: v.expenseCategories[i],
    }));
  }
  return v.expenseCategories.map((name) => ({
    slug: expenseCategorySlug(name),
    name,
  }));
}

/**
 * Totals per category for display: active categories in order, then hidden
 * categories that have spend, then unknown slugs that have spend (label = slug).
 */
export function buildCategoryTotals(
  categories: ExpenseCategoryRow[],
  totals: Map<string, number>,
): { category: string; label: string; totalCents: number }[] {
  const known = new Set(categories.map((c) => c.slug));
  const row = (category: string, label: string) => ({
    category,
    label,
    totalCents: totals.get(category) ?? 0,
  });
  return [
    ...categories.filter((c) => c.isActive).map((c) => row(c.slug, c.name)),
    ...categories
      .filter((c) => !c.isActive && (totals.get(c.slug) ?? 0) !== 0)
      .map((c) => row(c.slug, c.name)),
    ...[...totals.keys()]
      .filter((slug) => !known.has(slug) && (totals.get(slug) ?? 0) !== 0)
      .map((slug) => row(slug, slug)),
  ];
}
