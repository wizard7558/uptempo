// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;
const slugs: string[] = [];

function makeSlug(tag: string): string {
  const slug = `r60${tag}${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  slugs.push(slug);
  return slug;
}

async function execute(statement: string): Promise<void> {
  const { publicDb } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  await publicDb.execute(sql.raw(statement));
}

async function runRepair(slugsToCheck: string[], apply: boolean) {
  const { publicDb } = await import("@/lib/db");
  const { tenants } = await import("@/lib/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { migrations, LATEST_SCHEMA_VERSION } = await import("./index");
  const repairMigrations = migrations.filter((migration) => migration.version >= 33);
  const { inspectTenantSchema, runRepairCommand } = await import("../../../../scripts/repair-tenant-schemas");

  const result = await runRepairCommand({
    apply,
    migrations: repairMigrations,
    latestSchemaVersion: LATEST_SCHEMA_VERSION,
    backend: {
      execute: (query) => publicDb.execute(query),
      listTenants: () => publicDb.select({
        slug: tenants.slug,
        status: tenants.status,
        schemaVersion: tenants.schemaVersion,
        dbShard: tenants.dbShard,
      }).from(tenants).where(inArray(tenants.slug, slugsToCheck)),
      inspectTenant: (tenant, executor) => inspectTenantSchema(tenant, executor, repairMigrations),
      transaction: (operation) => publicDb.transaction(async (transaction) => operation({
        execute: (query) => transaction.execute(query),
        lockTenant: async (slug) => {
          const [tenant] = await transaction.select({
            slug: tenants.slug,
            status: tenants.status,
            schemaVersion: tenants.schemaVersion,
            dbShard: tenants.dbShard,
          }).from(tenants).where(eq(tenants.slug, slug)).for("update");
          return tenant ?? null;
        },
        applyMigration: async (migration, schema) => {
          for (const statement of migration.up(schema)) await transaction.execute(statement);
        },
        setSchemaVersion: async (slug, version) => {
          await transaction.update(tenants).set({ schemaVersion: version, updatedAt: new Date() })
            .where(eq(tenants.slug, slug));
        },
      })),
    },
  });
  return result;
}

async function tenantVersion(slug: string): Promise<number> {
  const { publicDb } = await import("@/lib/db");
  const { tenants } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [row] = await publicDb.select({ schemaVersion: tenants.schemaVersion })
    .from(tenants).where(eq(tenants.slug, slug));
  return row.schemaVersion;
}

async function dropTestTenants() {
  const { dropTenantSchema } = await import("../provision");
  for (const slug of slugs) {
    try {
      await dropTenantSchema(slug);
    } catch {
      // A failed fixture may not have inserted its tenant row yet.
    }
  }
}

afterAll(async () => {
  if (!DATABASE_URL) return;
  await dropTestTenants();
  const { closePublicDb } = await import("@/lib/db");
  const { closeShardClients } = await import("@/lib/db/shards");
  await closePublicDb();
  await closeShardClients();
});

describe("migration 0060 repair inspection (PostgreSQL integration)", () => {
  itDb("repairs a genuine v59 tenant once, then reports v60 present without replay", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { migrations } = await import("./index");
    const { inspectTenantSchema } = await import("../../../../scripts/repair-tenant-schemas");
    const slug = makeSlug("v59");
    await provisionTenantSchema({ name: "Repair v59", slug, throughVersion: 59 });
    const [record] = await (await import("@/lib/db")).publicDb
      .select({ slug: (await import("@/lib/db/schema")).tenants.slug, status: (await import("@/lib/db/schema")).tenants.status,
        schemaVersion: (await import("@/lib/db/schema")).tenants.schemaVersion, dbShard: (await import("@/lib/db/schema")).tenants.dbShard })
      .from((await import("@/lib/db/schema")).tenants)
      .where((await import("drizzle-orm")).eq((await import("@/lib/db/schema")).tenants.slug, slug));
    const { publicDb } = await import("@/lib/db");
    const missing = await inspectTenantSchema(record, publicDb, migrations.filter((migration) => migration.version >= 33));
    expect(missing.states.get(60)).toBe("missing");
    expect(missing.renamed0040).toBe(true);

    const applied = await runRepair([slug], true);
    expect(applied.exitCode).toBe(0);
    expect(applied.reports[0].applied).toEqual([60]);
    expect(await tenantVersion(slug)).toBe(60);

    const dryRun = await runRepair([slug], false);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.reports[0].states.get(60)).toBe("present");
    expect(dryRun.missingBefore.get(slug)).toEqual([]);
    expect(dryRun.reports[0].applied).toEqual([]);
    expect(await tenantVersion(slug)).toBe(60);
  }, 180_000);

  itDb("recognizes fresh v60 and resolves pre-0040 markers from the ordinary staff table", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { migrations, LATEST_SCHEMA_VERSION } = await import("./index");
    const { inspectTenantSchema } = await import("../../../../scripts/repair-tenant-schemas");
    const { tenants } = await import("@/lib/db/schema");
    const { publicDb } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const slug = makeSlug("fresh");
    await provisionTenantSchema({ name: "Repair fresh", slug });
    const [record] = await publicDb.select({
      slug: tenants.slug, status: tenants.status, schemaVersion: tenants.schemaVersion, dbShard: tenants.dbShard,
    }).from(tenants).where(eq(tenants.slug, slug));
    const report = await inspectTenantSchema(record, publicDb, migrations.filter((migration) => migration.version >= 33));
    expect(record.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(report.renamed0040).toBe(true);
    expect(report.states.get(60), JSON.stringify({ objects: report.partialDetail.get(60), state: report.states.get(60) })).toBe("present");
    for (let version = 33; version < 40; version++) expect(report.states.get(version)).toBe("present");
  }, 180_000);

  itDb("defers v60 inspection for a legitimate pre-0040 schema until repairs run in one transaction", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { migrations, LATEST_SCHEMA_VERSION, TENANT_BASELINE_VERSION } = await import("./index");
    const { inspectTenantSchema } = await import("../../../../scripts/repair-tenant-schemas");
    const { tenants } = await import("@/lib/db/schema");
    const { publicDb } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const slug = makeSlug("pre40");
    await provisionTenantSchema({ name: "Repair pre 0040", slug, throughVersion: 39 });
    const [record] = await publicDb.select({
      slug: tenants.slug, status: tenants.status, schemaVersion: tenants.schemaVersion, dbShard: tenants.dbShard,
    }).from(tenants).where(eq(tenants.slug, slug));
    const repairMigrations = migrations.filter((migration) => migration.version >= 33);
    const before = await inspectTenantSchema(record, publicDb, repairMigrations);
    expect(before.renamed0040).toBe(false);
    expect(before.states.get(60)).toBe("missing");
    expect(before.deferred.has(60)).toBe(true);
    expect(before.states.get(60)).not.toBe("partial");

    const repaired = await runRepair([slug], true);
    expect(repaired.exitCode).toBe(0);
    expect(repaired.reports[0].states.get(60)).toBe("present");
    expect(repaired.reports[0].applied).toContain(40);
    expect(repaired.reports[0].applied).toContain(60);
    expect(await tenantVersion(slug)).toBe(LATEST_SCHEMA_VERSION);
    expect(TENANT_BASELINE_VERSION).toBe(6);
  }, 240_000);

  itDb("reports wrong view, disabled or missing trigger, and stale alias as manual without writes", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const cases = ["wrong-view", "wrong-function", "disabled-trigger", "missing-trigger", "stale-alias"] as const;
    for (const testCase of cases) {
      const slug = makeSlug(testCase.replaceAll("-", ""));
      const { schemaName } = await provisionTenantSchema({ name: `Repair ${testCase}`, slug });
      if (testCase === "wrong-view") {
        await execute(`CREATE OR REPLACE VIEW "${schemaName}"."stylists" WITH (security_invoker = true) AS
          SELECT id, user_id, email, display_name, photo_url, bio, role, is_active, created_at, updated_at,
            default_assistant_id, phone, target_hours_per_week, target_hourly_earnings_cents
          FROM "${schemaName}"."staff"`);
      } else if (testCase === "wrong-function") {
        await execute(`CREATE OR REPLACE FUNCTION "${schemaName}"."domain_compat_sync_staff_id_0060"()
          RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $failure$
          BEGIN RETURN NEW; END $failure$`);
      } else if (testCase === "disabled-trigger") {
        await execute(`ALTER TABLE "${schemaName}"."appointments" DISABLE TRIGGER "domain_compat_sync_0060"`);
      } else if (testCase === "missing-trigger") {
        await execute(`DROP TRIGGER "domain_compat_sync_0060" ON "${schemaName}"."appointments"`);
      } else {
        const staffId = randomUUID();
        await execute(`INSERT INTO "${schemaName}"."staff" (id, display_name, role)
          VALUES ('${staffId}', 'Repair Alias Fixture', 'provider')`);
        await execute(`INSERT INTO "${schemaName}"."working_hours" (staff_id, day_of_week, start_time, end_time)
          VALUES ('${staffId}', 1, '09:00', '12:00')`);
        await execute(`ALTER TABLE "${schemaName}"."working_hours" DISABLE TRIGGER "domain_compat_sync_0060"`);
        await execute(`UPDATE "${schemaName}"."working_hours" SET stylist_id = '${randomUUID()}' WHERE staff_id = '${staffId}'`);
        await execute(`ALTER TABLE "${schemaName}"."working_hours" ENABLE TRIGGER "domain_compat_sync_0060"`);
      }

      // Add an unrelated missing migration so the full-tenant no-write gate is exercised.
      await execute(`ALTER TABLE "${schemaName}"."appointments" DROP COLUMN checked_in_at`);
      const result = await runRepair([slug], true);
      expect(result.exitCode).toBe(1);
      expect(result.reports[0].states.get(59)).toBe("missing");
      expect(result.reports[0].states.get(60)).toBe("partial");
      expect(result.reports[0].error).toContain("skipped all tenant apply work");
      if (testCase === "stale-alias") {
        expect(result.reports[0].partialDetail.get(60)).toContain("data working_hours.stylist_id");
      }
      expect(result.reports[0].applied).toEqual([]);
      expect(await tenantVersion(slug)).toBe(60);
      const columns = await (await import("@/lib/db")).publicDb.execute(
        (await import("drizzle-orm")).sql`SELECT column_name FROM information_schema.columns
          WHERE table_schema = ${schemaName} AND table_name = 'appointments' AND column_name = 'checked_in_at'`,
      );
      expect(Array.from(columns as Iterable<Record<string, unknown>>)).toHaveLength(0);
    }
  }, 240_000);

  itDb("rolls back the whole transaction and keeps schema_version when the 0060 assertion fails", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { schemaName } = await provisionTenantSchema({ name: "Repair rollback", slug: makeSlug("rollback"), throughVersion: 59 });
    const slug = slugs.at(-1)!;
    const staffId = randomUUID();
    await execute(`INSERT INTO "${schemaName}"."staff" (id, display_name, role)
      VALUES ('${staffId}', 'Repair Rollback Fixture', 'provider')`);
    await execute(`CREATE FUNCTION "${schemaName}"."repair_fail_v60"() RETURNS trigger
      LANGUAGE plpgsql SET search_path = pg_catalog AS $failure$
      BEGIN RAISE EXCEPTION 'intentional repair rollback fixture'; END $failure$`);
    await execute(`CREATE TRIGGER repair_fail_v60 BEFORE UPDATE ON "${schemaName}"."staff"
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}"."repair_fail_v60"()`);

    const result = await runRepair([slug], true);
    expect(result.exitCode).toBe(1);
    expect(result.reports[0].error).toContain("apply failed (rolled back)");
    expect(await tenantVersion(slug)).toBe(59);
    const { publicDb } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    const remaining = await publicDb.execute(sql`
      SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema = ${schemaName} AND column_name IN ('legacy_stylist_role', 'stylist_id', 'beauty_bank_cents')
    `);
    expect(Number(Array.from(remaining as Iterable<Record<string, unknown>>)[0]?.count)).toBe(0);
  }, 180_000);
});
