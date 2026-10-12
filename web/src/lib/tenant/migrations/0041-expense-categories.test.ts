// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

// Integration test (run via `npm run test:db`); skipped when DATABASE_URL is unset.
const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;

const testSlugs: string[] = [];
const makeSlug = (tag: string) => {
  const slug = `m41${tag}${Date.now()}${Math.floor(Math.random() * 1000)}`;
  testSlugs.push(slug);
  return slug;
};

afterAll(async () => {
  if (!DATABASE_URL) return;
  const { dropTenantSchema } = await import("../provision");
  for (const slug of testSlugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // ignore cleanup errors
    }
  }
});

async function rows(q: ReturnType<typeof import("drizzle-orm").sql>) {
  const { publicDb } = await import("@/lib/db");
  return Array.from((await publicDb.execute(q)) as Iterable<Record<string, unknown>>);
}

describe("migration 0041 expense_categories (integration)", () => {
  itDb("backfills used categories, round-trips, and re-runs cleanly", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { migrateTenant, rollbackTenant } = await import("./runner");
    const { LATEST_SCHEMA_VERSION } = await import("./index");
    const { schemaFingerprint } = await import("../schema-fingerprint");
    const { sql } = await import("drizzle-orm");

    const slug = makeSlug("a");
    const schema = `tenant_${slug}`;
    await provisionTenantSchema({ name: "M41 A", slug, throughVersion: 40 });

    const q = `"${schema}"`;
    for (const [cat, cents] of [["color", 100], ["rent", 200], ["rent", 300], ["misc stuff", 400]] as const) {
      await rows(
        sql.raw(
          `INSERT INTO ${q}.expenses (expense_date, vendor_name, category, amount_cents) VALUES ('2030-01-01', 'V', '${cat}', ${cents})`,
        ),
      );
    }

    const fp40 = await schemaFingerprint(schema);
    const up = await migrateTenant(slug, 40);
    expect(up.error).toBeUndefined();
    expect(up.toVersion).toBe(LATEST_SCHEMA_VERSION);

    const cats = await rows(
      sql.raw(`SELECT slug, name, is_default, sort_order FROM ${q}.expense_categories ORDER BY slug`),
    );
    expect(Object.fromEntries(cats.map((r) => [r.slug, r.name]))).toEqual({
      color: "Color",
      rent: "Rent",
      "misc stuff": "Misc Stuff",
    });
    for (const r of cats) {
      expect(r.is_default).toBe(0);
      expect(r.sort_order).toBe(1000);
    }

    const down = await rollbackTenant(slug, LATEST_SCHEMA_VERSION, 40);
    expect(down.error).toBeUndefined();
    expect(await schemaFingerprint(schema)).toEqual(fp40);
    const n = await rows(sql.raw(`SELECT count(*)::int AS n FROM ${q}.expenses`));
    expect(n[0].n).toBe(4);

    const again = await migrateTenant(slug, 40);
    expect(again.error).toBeUndefined();
    expect(again.toVersion).toBe(LATEST_SCHEMA_VERSION);
  }, 120000);
});
