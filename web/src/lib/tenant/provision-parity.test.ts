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
});
