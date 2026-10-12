// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

const itDb = process.env.DATABASE_URL ? it : it.skip;

const slugs: string[] = [];
const makeSlug = (tag: string) => {
  const slug = `t58${tag}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
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

describe("0058 branding theme migration", () => {
  itDb(
    "matches a fresh tenant and backfills brand color from primary_color",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { schemaFingerprint } = await import("../schema-fingerprint");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");
      const { pgErrorInfo } = await import("@/lib/db/pg-error");
      const { migration } = await import("./0058-branding-theme");
      const { MARKERS, markerPresent } = await import("../../../../scripts/repair-tenant-schemas");

      const run = async (query: string) =>
        Array.from(
          (await publicDb.execute(sql.raw(query))) as Iterable<Record<string, unknown>>,
        );

      const fresh = makeSlug("a");
      const migrated = makeSlug("b");
      await provisionTenantSchema({ name: "Theme fresh", slug: fresh });
      await provisionTenantSchema({ name: "Theme old", slug: migrated, throughVersion: 57 });
      const freshSchema = `tenant_${fresh}`;
      const schema = `tenant_${migrated}`;
      const fpFresh = await schemaFingerprint(freshSchema);
      const fpOld = await schemaFingerprint(schema);
      expect(fpOld).not.toEqual(fpFresh);

      await run(`
        INSERT INTO "${schema}".branding_settings (primary_color, font_preference) VALUES
          ('#6b8f3c', 'system'),
          ('#6B8F3C', 'serif'),
          ('#123456', 'sans-serif'),
          (NULL, NULL)
      `);

      const up = await migrateTenant(migrated, 57);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(schema)).toEqual(fpFresh);

      const read = () =>
        run(
          `SELECT primary_color, brand_color, font_pairing, corner_style, density, color_mode FROM "${schema}".branding_settings`,
        );
      const byPrimary = async () => {
        const map = new Map<string, Record<string, unknown>>();
        for (const row of await read()) {
          map.set(row.primary_color == null ? "NULL" : String(row.primary_color), row);
        }
        return map;
      };

      const first = await byPrimary();
      expect(first.get("#6b8f3c")).toMatchObject({
        brand_color: "#B3122E",
        font_pairing: "score",
        corner_style: "soft",
        density: "comfortable",
        color_mode: "light",
      });
      expect(first.get("#6B8F3C")).toMatchObject({
        brand_color: "#B3122E",
        font_pairing: "score",
      });
      expect(first.get("#123456")).toMatchObject({
        brand_color: "#123456",
        font_pairing: "sans",
      });
      expect(first.get("NULL")).toMatchObject({
        brand_color: "#B3122E",
        font_pairing: "score",
      });

      for (const stmt of migration.up(schema)) {
        await publicDb.execute(stmt);
      }
      const second = await byPrimary();
      expect(second.get("#6b8f3c")).toMatchObject({ brand_color: "#B3122E" });
      expect(second.get("#123456")).toMatchObject({ brand_color: "#123456", font_pairing: "sans" });

      let rejected: unknown;
      try {
        await run(`INSERT INTO "${schema}".branding_settings (font_pairing) VALUES ('serif')`);
      } catch (error) {
        rejected = error;
      }
      expect(pgErrorInfo(rejected)).toMatchObject({
        code: "23514",
        constraint: "branding_settings_font_pairing_check",
      });

      const info = await run(
        `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = '${schema}'`,
      );
      const cols = new Set(info.map((row) => `${row.table_name}.${row.column_name}`));
      const tbls = new Set(info.map((row) => String(row.table_name)));
      const idxRows = await run(`SELECT indexname FROM pg_indexes WHERE schemaname = '${schema}'`);
      const idxs = new Set(idxRows.map((row) => String(row.indexname)));
      for (const marker of MARKERS[58]) {
        expect(markerPresent(marker, cols, idxs, tbls)).toBe(true);
      }

      const down = await rollbackTenant(migrated, LATEST_SCHEMA_VERSION, 57);
      expect(down.error).toBeUndefined();
      expect(await schemaFingerprint(schema)).toEqual(fpOld);
      const dropped = await run(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'branding_settings' AND column_name = 'brand_color'`,
      );
      expect(dropped).toEqual([]);

      const again = await migrateTenant(migrated, 57);
      expect(again.error).toBeUndefined();
      expect(again.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(schema)).toEqual(fpFresh);
      const restored = await byPrimary();
      expect(restored.get("#6b8f3c")).toMatchObject({ brand_color: "#B3122E" });
      expect(restored.get("#123456")).toMatchObject({ brand_color: "#123456", font_pairing: "sans" });

      const noop = await migrateTenant(migrated, LATEST_SCHEMA_VERSION);
      expect(noop.error).toBeUndefined();
      expect(noop.applied).toBe(0);
      expect(await schemaFingerprint(schema)).toEqual(fpFresh);
    },
    180_000,
  );
});
