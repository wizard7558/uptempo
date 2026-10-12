import { describe, it, expect } from "vitest";
import {
  EXPENSE_CATEGORY_OPTIONS,
  buildCategoryTotals,
  expenseCategorySlug,
  packExpenseCategories,
  type ExpenseCategoryRow,
} from "./categories";
import { VERTICALS } from "@/lib/verticals";

describe("packExpenseCategories", () => {
  for (const [id, pack] of Object.entries(VERTICALS)) {
    it(`${id}: slugs are unique, non-empty, and include other`, () => {
      const slugs = packExpenseCategories(pack).map((c) => c.slug);
      expect(slugs.every((s) => s.length > 0)).toBe(true);
      expect(new Set(slugs).size).toBe(slugs.length);
      expect(slugs).toContain("other");
    });
  }

  it("hair_salon equals the legacy options", () => {
    expect(
      packExpenseCategories(VERTICALS.hair_salon).map((c) => ({
        value: c.slug,
        label: c.name,
      })),
    ).toEqual(EXPENSE_CATEGORY_OPTIONS);
  });

  it("tattoo defaults are the 7 tattoo slugs", () => {
    expect(packExpenseCategories(VERTICALS.tattoo).map((c) => c.slug)).toEqual([
      "ink",
      "needles_and_cartridges",
      "disposables",
      "booth_rent",
      "equipment",
      "licensing",
      "other",
    ]);
  });
});

describe("expenseCategorySlug", () => {
  it("normalizes labels", () => {
    expect(expenseCategorySlug("Tools and equipment")).toBe("tools_and_equipment");
    expect(expenseCategorySlug("Needles & cartridges")).toBe("needles_and_cartridges");
    expect(expenseCategorySlug("  --Other!! ")).toBe("other");
    expect(expenseCategorySlug("!!!")).toBe("");
  });
});

describe("buildCategoryTotals", () => {
  const row = (slug: string, sortOrder: number, isActive: boolean): ExpenseCategoryRow => ({
    id: slug,
    slug,
    name: slug.toUpperCase(),
    sortOrder,
    isDefault: true,
    isActive,
  });
  const cats = [row("a", 1, true), row("b", 2, false), row("c", 3, false), row("d", 4, true)];

  it("orders active, then hidden with spend, then unknown with spend", () => {
    const totals = new Map([["b", 500], ["zzz", 700], ["a", 100]]);
    expect(buildCategoryTotals(cats, totals)).toEqual([
      { category: "a", label: "A", totalCents: 100 },
      { category: "d", label: "D", totalCents: 0 },
      { category: "b", label: "B", totalCents: 500 },
      { category: "zzz", label: "zzz", totalCents: 700 },
    ]);
  });

  it("omits hidden categories without spend", () => {
    expect(buildCategoryTotals(cats, new Map()).map((r) => r.category)).toEqual(["a", "d"]);
  });
});
