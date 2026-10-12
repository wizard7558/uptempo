// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

// Integration test (run via `npm run test:db`); skipped when DATABASE_URL is unset.
const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;

const testSlugs: string[] = [];
const makeSlug = (tag: string) => {
  const slug = `xs${tag}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  testSlugs.push(slug);
  return slug;
};

afterAll(async () => {
  if (!DATABASE_URL) return;
  const { dropTenantSchema } = await import("../tenant/provision");
  for (const slug of testSlugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // ignore cleanup errors
    }
  }
});

describe("ensureExpenseCategories (integration)", () => {
  itDb("hair tenant: legacy rows become defaults, keep ids, and a second call adds nothing", async () => {
    const { provisionTenantSchema } = await import("../tenant/provision");
    const { ensureExpenseCategories, listExpenseCategoryRows } = await import("./seed");
    const { publicDb } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");

    const slug = makeSlug("h");
    await provisionTenantSchema({ name: "Seed Hair", slug });
    const q = `"tenant_${slug}"`;
    // A legacy-style row that exists before seeding (as 0041 would backfill).
    await publicDb.execute(
      sql.raw(`INSERT INTO ${q}.expense_categories (slug, name, sort_order, is_default) VALUES ('color', 'Color', 1000, 0)`),
    );
    const before = await listExpenseCategoryRows(slug, { includeHidden: true });
    const colorId = before.find((r) => r.slug === "color")!.id;

    await ensureExpenseCategories(slug);
    const after = await listExpenseCategoryRows(slug, { includeHidden: true });
    expect(after).toHaveLength(9);
    expect(after.every((r) => r.isDefault)).toBe(true);
    expect(after.find((r) => r.slug === "color")!.id).toBe(colorId);
    expect(after[0].slug).toBe("color");

    await ensureExpenseCategories(slug);
    expect(await listExpenseCategoryRows(slug, { includeHidden: true })).toHaveLength(9);
  }, 60000);

  itDb("hair tenant: existing expense labels are unchanged after seeding", async () => {
    const { provisionTenantSchema } = await import("../tenant/provision");
    const { ensureExpenseCategories, listExpenseCategoryRows } = await import("./seed");
    const { HAIR_SALON_EXPENSE_CATEGORY_VALUES, hairSalon } = await import("@/lib/verticals/hair-salon");

    const slug = makeSlug("l");
    await provisionTenantSchema({ name: "Seed Labels", slug });
    await ensureExpenseCategories(slug);
    const rows = await listExpenseCategoryRows(slug, { includeHidden: false });
    expect(rows.map((r) => [r.slug, r.name])).toEqual(
      HAIR_SALON_EXPENSE_CATEGORY_VALUES.map((v, i) => [v, hairSalon.expenseCategories[i]]),
    );
  }, 60000);

  itDb("tattoo tenant: defaults are the 7 tattoo slugs", async () => {
    const { provisionTenantSchema } = await import("../tenant/provision");
    const { ensureExpenseCategories, listExpenseCategoryRows } = await import("./seed");
    const { publicDb } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");

    const slug = makeSlug("t");
    await provisionTenantSchema({ name: "Seed Tattoo", slug });
    await publicDb.execute(sql`UPDATE tenants SET industry = 'tattoo' WHERE slug = ${slug}`);
    await ensureExpenseCategories(slug);
    const rows = await listExpenseCategoryRows(slug, { includeHidden: true });
    expect(rows.map((r) => r.slug)).toEqual([
      "ink",
      "needles_and_cartridges",
      "disposables",
      "booth_rent",
      "equipment",
      "licensing",
      "other",
    ]);
  }, 60000);
});
