// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

// Skip when DATABASE_URL is not set (same convention as provision.test.ts)
const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;

const testSlugs: string[] = [];

afterAll(async () => {
  if (!DATABASE_URL || testSlugs.length === 0) return;
  const { dropTenantSchema } = await import("./provision");
  for (const slug of testSlugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe("tenant provisioning parity (integration)", () => {
  itDb(
    "a freshly provisioned schema has every table and column declared in tenant-schema/tables.ts",
    async () => {
      const { provisionTenantSchema } = await import("./provision");
      const { publicDb } = await import("@/lib/db");
      const { tenants } = await import("@/lib/db/schema");
      const { createTenantTables } = await import(
        "@/lib/db/tenant-schema/tables"
      );
      const { LATEST_SCHEMA_VERSION } = await import("./migrations");
      const { sql, eq } = await import("drizzle-orm");
      const { pgSchema, getTableConfig } = await import(
        "drizzle-orm/pg-core"
      );

      const slug = `parity${Date.now()}${Math.floor(Math.random() * 1000)}`;
      testSlugs.push(slug);
      const schemaName = `tenant_${slug}`;
      await provisionTenantSchema({ name: "Parity Salon", slug });

      const result = await publicDb.execute(
        sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = ${schemaName}`,
      );
      const actual = new Map<string, Set<string>>();
      for (const row of Array.from(
        result as Iterable<Record<string, unknown>>,
      )) {
        const t = row.table_name as string;
        if (!actual.has(t)) actual.set(t, new Set());
        actual.get(t)!.add(row.column_name as string);
      }

      const tables = createTenantTables(pgSchema(schemaName));
      const missing: string[] = [];
      let declared = 0;
      for (const table of Object.values(tables)) {
        const config = getTableConfig(table as never);
        declared++;
        const cols = actual.get(config.name);
        if (!cols) {
          missing.push(`table ${config.name}`);
          continue;
        }
        for (const col of config.columns) {
          if (!cols.has(col.name)) missing.push(`${config.name}.${col.name}`);
        }
      }
      expect(declared).toBeGreaterThan(0);
      expect(missing, `Missing in provisioned schema: ${missing.join(", ")}`).toEqual([]);

      const [row] = await publicDb
        .select({ v: tenants.schemaVersion })
        .from(tenants)
        .where(eq(tenants.slug, slug));
      expect(row.v).toBe(LATEST_SCHEMA_VERSION);
    },
    60000,
  );

  itDb(
    "fresh v60 provisioning matches baseline-6 provisioning migrated through the full registry",
    async () => {
      const { provisionTenantSchema } = await import("./provision");
      const { migrateTenant } = await import("./migrations/runner");
      const { publicDb } = await import("@/lib/db");
      const { tenants } = await import("@/lib/db/schema");
      const { schemaFingerprint } = await import("./schema-fingerprint");
      const { LATEST_SCHEMA_VERSION, TENANT_BASELINE_VERSION } = await import("./migrations");
      const { eq } = await import("drizzle-orm");

      const nonce = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const freshSlug = `parityfresh${nonce}`;
      const migratedSlug = `paritybase${nonce}`;
      testSlugs.push(freshSlug, migratedSlug);

      const fresh = await provisionTenantSchema({ name: "Parity Fresh v60", slug: freshSlug });
      const baseline = await provisionTenantSchema({
        name: "Parity Baseline 6",
        slug: migratedSlug,
        throughVersion: TENANT_BASELINE_VERSION,
      });
      expect(fresh.schemaName).toBe(`tenant_${freshSlug}`);
      expect(baseline.schemaName).toBe(`tenant_${migratedSlug}`);

      const before = await publicDb
        .select({ schemaVersion: tenants.schemaVersion })
        .from(tenants)
        .where(eq(tenants.slug, migratedSlug));
      expect(before[0]?.schemaVersion).toBe(TENANT_BASELINE_VERSION);

      const migrated = await migrateTenant(migratedSlug, TENANT_BASELINE_VERSION);
      expect(migrated.error).toBeUndefined();
      expect(migrated.toVersion).toBe(LATEST_SCHEMA_VERSION);

      for (const slug of [freshSlug, migratedSlug]) {
        const [row] = await publicDb
          .select({ schemaVersion: tenants.schemaVersion })
          .from(tenants)
          .where(eq(tenants.slug, slug));
        expect(row?.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
      }

      const freshFingerprint = await schemaFingerprint(fresh.schemaName);
      const migratedFingerprint = await schemaFingerprint(baseline.schemaName);
      for (const fingerprint of [freshFingerprint, migratedFingerprint]) {
        expect(fingerprint.length).toBeGreaterThan(0);
        expect(fingerprint.some((line) => line.startsWith("col "))).toBe(true);
        expect(fingerprint.some((line) => line.startsWith("con "))).toBe(true);
        expect(fingerprint.some((line) => line.startsWith("idx "))).toBe(true);
      }
      expect(migratedFingerprint).toEqual(freshFingerprint);
    },
    60000,
  );
});
