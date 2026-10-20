import { describe, expect, it } from "vitest";
import {
  filterServiceCategoriesForIndustry,
  formatTenantServiceCategory,
  getSuppressibleLegacyCategorySlugs,
  type TenantServiceCategory,
} from "./categories";
import { listVerticals } from "@/lib/verticals";

function category(
  slug: string,
  name: string,
  isDefault = false,
): TenantServiceCategory {
  return { slug, name, isDefault, isActive: true };
}

describe("tenant service categories", () => {
  it("only considers untouched hair defaults outside the current pack", () => {
    const rows = [
      category("other", "Other", true),
      category("custom", "Custom", false),
      category("extensions", "Extensions", true),
      category("cut", "Renamed category", true),
      category("custom-slug", "Business category", false),
      category("old-style", "Old style", true),
    ];

    expect(getSuppressibleLegacyCategorySlugs(rows, "tattoo")).toEqual([
      "extensions",
    ]);
    expect(
      filterServiceCategoriesForIndustry(rows, "tattoo", new Set()).map(
        (row) => row.slug,
      ),
    ).toEqual(["other", "custom", "cut", "custom-slug", "old-style"]);
  });

  it("keeps a legacy default when an active or inactive service references it", () => {
    const rows = [category("color", "Color", true)];

    expect(
      filterServiceCategoriesForIndustry(rows, "tattoo", new Set(["color"])),
    ).toEqual(rows);
  });

  it("retains categories for all 8 packs", () => {
    for (const pack of listVerticals()) {
      const rows = pack.categories.map((item) =>
        category(item.slug, item.name, true),
      );
      expect(filterServiceCategoriesForIndustry(rows, pack.id)).toEqual(rows);
    }
  });

  it("uses the general pack for unknown industries", () => {
    const rows = [category("cut", "Cut", true), category("other", "Other", true)];

    expect(filterServiceCategoriesForIndustry(rows, "unknown-industry")).toEqual(
      filterServiceCategoriesForIndustry(rows, "general"),
    );
  });

  it("prefers tenant labels and renders unknown slugs readably", () => {
    const options = [category("flash", "Flash designs")];

    expect(formatTenantServiceCategory("flash", options)).toBe("Flash designs");
    expect(formatTenantServiceCategory("legacy_hair-color", options)).toBe(
      "Legacy Hair Color",
    );
    expect(formatTenantServiceCategory(null, options)).toBe("Other");
  });
});
