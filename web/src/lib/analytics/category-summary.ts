import {
  buildCategoryTotals,
  type ExpenseCategoryRow,
} from "@/lib/expenses/categories";

export type CategoryRevenueRow = {
  /** services.category; null is treated as "other". */
  category: string | null;
  totalCents: number;
  serviceCostCents: number;
  bookings: number;
  totalMinutes: number;
};

export type ServiceCategoryInput = {
  slug: string;
  name: string;
  isActive: boolean;
};

export type CategorySummary = {
  revenueByCategory: {
    category: string;
    label: string;
    totalCents: number;
    bookings: number;
    totalMinutes: number;
    serviceCostCents: number;
    mappedExpenseCents: number;
  }[];
  expenseByCategory: { category: string; label: string; totalCents: number }[];
  totalRevenueCents: number;
  totalExpenseCents: number;
  totalServiceCostCents: number;
  grossMarginCents: number;
  netCents: number;
};

const normalizeSlug = (slug: string) => slug.replace(/-/g, "_");

/**
 * Revenue versus expenses for any industry. Service categories come from the
 * tenant's own `service_categories` rows (in order); revenue under a slug that
 * has no row still counts and is labelled from the industry pack. An expense
 * category is a service type's direct cost when the normalized slugs match
 * (never "other").
 */
export function buildCategorySummary(input: {
  serviceCategories: ServiceCategoryInput[];
  packCategories: { slug: string; name: string }[];
  revenueRows: CategoryRevenueRow[];
  expenseRows: { category: string; totalCents: number }[];
  expenseCategories: ExpenseCategoryRow[];
}): CategorySummary {
  const { serviceCategories, packCategories, revenueRows, expenseRows } = input;

  const byCat = new Map<string, CategoryRevenueRow>();
  for (const row of revenueRows) {
    const key = row.category ?? "other";
    const prev = byCat.get(key);
    byCat.set(
      key,
      prev
        ? {
            category: key,
            totalCents: prev.totalCents + row.totalCents,
            serviceCostCents: prev.serviceCostCents + row.serviceCostCents,
            bookings: prev.bookings + row.bookings,
            totalMinutes: prev.totalMinutes + row.totalMinutes,
          }
        : { ...row, category: key },
    );
  }

  const expenseMap = new Map(expenseRows.map((r) => [r.category, r.totalCents]));

  const listed = serviceCategories.filter((c) => c.isActive);
  const known = new Set(serviceCategories.map((c) => c.slug));
  const packLabels = new Map(packCategories.map((c) => [c.slug, c.name]));
  const extras = [...byCat.keys()]
    .filter((slug) => !known.has(slug))
    .map((slug) => ({ slug, name: packLabels.get(slug) ?? slug }));
  // Inactive categories still show when they have revenue.
  const hiddenWithRevenue = serviceCategories.filter(
    (c) => !c.isActive && (byCat.get(c.slug)?.totalCents ?? 0) !== 0,
  );

  const mappedExpenseFor = (slug: string): number => {
    const norm = normalizeSlug(slug);
    if (norm === "other") return 0;
    let sum = 0;
    for (const [expSlug, cents] of expenseMap) {
      if (normalizeSlug(expSlug) === norm) sum += cents;
    }
    return sum;
  };

  const revenueByCategory = [...listed, ...hiddenWithRevenue, ...extras].map(
    (c) => {
      const r = byCat.get(c.slug);
      return {
        category: c.slug,
        label: c.name,
        totalCents: r?.totalCents ?? 0,
        bookings: r?.bookings ?? 0,
        totalMinutes: r?.totalMinutes ?? 0,
        serviceCostCents: r?.serviceCostCents ?? 0,
        mappedExpenseCents: mappedExpenseFor(c.slug),
      };
    },
  );

  const expenseByCategory = buildCategoryTotals(
    input.expenseCategories,
    expenseMap,
  );

  // Totals cover every revenue row, including categories not listed above.
  const totalRevenueCents = [...byCat.values()].reduce(
    (s, r) => s + r.totalCents,
    0,
  );
  const totalServiceCostCents = [...byCat.values()].reduce(
    (s, r) => s + r.serviceCostCents,
    0,
  );
  const totalExpenseCents = expenseByCategory.reduce(
    (s, r) => s + r.totalCents,
    0,
  );

  return {
    revenueByCategory,
    expenseByCategory,
    totalRevenueCents,
    totalExpenseCents,
    totalServiceCostCents,
    grossMarginCents: totalRevenueCents - totalServiceCostCents,
    netCents: totalRevenueCents - totalExpenseCents,
  };
}
