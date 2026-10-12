import { describe, expect, it } from "vitest";
import { buildCategorySummary } from "./category-summary";
import { hairSalon } from "@/lib/verticals/hair-salon";
import { tattoo } from "@/lib/verticals/tattoo";
import {
  packExpenseCategories,
  type ExpenseCategoryRow,
} from "@/lib/expenses/categories";

const svcCats = (pack: { categories: { slug: string; name: string }[] }) =>
  pack.categories.map((c) => ({ ...c, isActive: true }));

const expCats = (defs: { slug: string; name: string }[]): ExpenseCategoryRow[] =>
  defs.map((d, i) => ({
    id: `id-${i}`,
    slug: d.slug,
    name: d.name,
    sortOrder: (i + 1) * 10,
    isDefault: true,
    isActive: true,
  }));

const rev = (category: string | null, totalCents: number, serviceCostCents = 0) => ({
  category,
  totalCents,
  serviceCostCents,
  bookings: 1,
  totalMinutes: 60,
});

describe("buildCategorySummary", () => {
  it("maps expenses to service types only for matching slugs (hair: color, extensions)", () => {
    const expenseCategories = expCats(packExpenseCategories(hairSalon));
    expect(expenseCategories).toHaveLength(9);
    const s = buildCategorySummary({
      serviceCategories: svcCats(hairSalon),
      packCategories: hairSalon.categories,
      revenueRows: [rev("color", 20000), rev("extensions", 30000), rev("other", 1000)],
      expenseRows: [
        { category: "color", totalCents: 4000 },
        { category: "extensions", totalCents: 6000 },
        { category: "other", totalCents: 900 },
        { category: "rent", totalCents: 50000 },
      ],
      expenseCategories,
    });
    expect(s.revenueByCategory).toHaveLength(7);
    const nonZero = s.revenueByCategory
      .filter((r) => r.mappedExpenseCents > 0)
      .map((r) => [r.category, r.mappedExpenseCents]);
    expect(nonZero).toEqual([
      ["color", 4000],
      ["extensions", 6000],
    ]);
    expect(s.expenseByCategory).toHaveLength(9);
    expect(s.totalExpenseCents).toBe(60900);
    expect(s.totalRevenueCents).toBe(51000);
    expect(s.netCents).toBe(51000 - 60900);
  });

  it("includes revenue from a custom service category in the totals", () => {
    const s = buildCategorySummary({
      serviceCategories: [
        ...svcCats(hairSalon),
        { slug: "maintenance", name: "Maintenance", isActive: true },
      ],
      packCategories: hairSalon.categories,
      revenueRows: [rev("color", 10000), rev("maintenance", 5000)],
      expenseRows: [],
      expenseCategories: expCats(packExpenseCategories(hairSalon)),
    });
    expect(s.totalRevenueCents).toBe(15000);
    expect(s.revenueByCategory.find((r) => r.category === "maintenance")?.totalCents).toBe(5000);
  });

  it("labels an unknown slug from the pack", () => {
    const s = buildCategorySummary({
      serviceCategories: [],
      packCategories: tattoo.categories,
      revenueRows: [rev("flash", 7000)],
      expenseRows: [],
      expenseCategories: expCats(packExpenseCategories(tattoo)),
    });
    expect(s.revenueByCategory).toHaveLength(1);
    expect(s.revenueByCategory[0]).toMatchObject({ category: "flash", label: "Flash", totalCents: 7000 });
    expect(s.totalRevenueCents).toBe(7000);
  });

  it("falls back to the raw slug when neither table nor pack knows it", () => {
    const s = buildCategorySummary({
      serviceCategories: [],
      packCategories: [],
      revenueRows: [rev(null, 100)],
      expenseRows: [],
      expenseCategories: [],
    });
    expect(s.revenueByCategory[0]).toMatchObject({ category: "other", label: "other" });
  });
});
