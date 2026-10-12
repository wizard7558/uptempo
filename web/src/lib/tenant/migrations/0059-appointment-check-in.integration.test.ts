// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

const itDb = process.env.DATABASE_URL ? it : it.skip;

const slugs: string[] = [];
const makeSlug = (tag: string) => {
  const slug = `t59${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  slugs.push(slug);
  return slug;
};

afterAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const { dropTenantSchema } = await import("../provision");
  for (const slug of slugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // Ignore cleanup errors
    }
  }
});

describe("0059 appointment check-in migration", () => {
  itDb(
    "matches a fresh tenant and down drops checked_in_at only",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { schemaFingerprint } = await import("../schema-fingerprint");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");
      const { migration } = await import("./0059-appointment-check-in");
      const { MARKERS, markerPresent } = await import("../../../../scripts/repair-tenant-schemas");

      const run = async (query: string) =>
        Array.from(
          (await publicDb.execute(sql.raw(query))) as Iterable<Record<string, unknown>>,
        );

      const appointmentColumns = async (schema: string) =>
        (
          await run(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'appointments' ORDER BY column_name`,
          )
        ).map((row) => String(row.column_name));

      const fresh = makeSlug("a");
      const migrated = makeSlug("b");
      await provisionTenantSchema({ name: "Check-in fresh", slug: fresh });
      await provisionTenantSchema({
        name: "Check-in old",
        slug: migrated,
        throughVersion: 58,
      });
      const freshSchema = `tenant_${fresh}`;
      const schema = `tenant_${migrated}`;
      const fpFresh = await schemaFingerprint(freshSchema);
      const fpOld = await schemaFingerprint(schema);
      expect(fpOld).not.toEqual(fpFresh);

      const before = await appointmentColumns(schema);
      expect(before).not.toContain("checked_in_at");

      const up = await migrateTenant(migrated, 58);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(schema)).toEqual(fpFresh);

      const after = await appointmentColumns(schema);
      expect(after.filter((name) => name !== "checked_in_at")).toEqual(before);
      expect(after).toContain("checked_in_at");

      for (const stmt of migration.up(schema)) {
        await publicDb.execute(stmt);
      }
      expect(await appointmentColumns(schema)).toEqual(after);
      expect(await schemaFingerprint(schema)).toEqual(fpFresh);

      const info = await run(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = '${schema}'`,
      );
      const cols = new Set(info.map((row) => `${row.table_name}.${row.column_name}`));
      const tbls = new Set(info.map((row) => String(row.table_name)));
      const idxRows = await run(`SELECT indexname FROM pg_indexes WHERE schemaname = '${schema}'`);
      const idxs = new Set(idxRows.map((row) => String(row.indexname)));
      for (const marker of MARKERS[59]) {
        expect(markerPresent(marker, cols, idxs, tbls)).toBe(true);
      }

      const down = await rollbackTenant(migrated, LATEST_SCHEMA_VERSION, 58);
      expect(down.error).toBeUndefined();
      expect(await schemaFingerprint(schema)).toEqual(fpOld);
      expect(await appointmentColumns(schema)).toEqual(before);

      const again = await migrateTenant(migrated, 58);
      expect(again.error).toBeUndefined();
      expect(again.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(schema)).toEqual(fpFresh);
      expect(await appointmentColumns(schema)).toContain("checked_in_at");

      const noop = await migrateTenant(migrated, LATEST_SCHEMA_VERSION);
      expect(noop.error).toBeUndefined();
      expect(noop.applied).toBe(0);
      expect(await schemaFingerprint(schema)).toEqual(fpFresh);
    },
    180_000,
  );
});
