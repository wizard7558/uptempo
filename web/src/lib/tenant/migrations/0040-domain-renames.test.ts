// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

// Integration test (run via `npm run test:db`); skipped when DATABASE_URL is unset.
const DATABASE_URL = process.env.DATABASE_URL;
const itDb = DATABASE_URL ? it : it.skip;

const testSlugs: string[] = [];
const makeSlug = (tag: string) => {
  const slug = `m40${tag}${Date.now()}${Math.floor(Math.random() * 1000)}`;
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

/** postgres-js errors may be wrapped by drizzle; look at the error and its cause. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

async function rows(q: ReturnType<typeof import("drizzle-orm").sql>) {
  const { publicDb } = await import("@/lib/db");
  return Array.from((await publicDb.execute(q)) as Iterable<Record<string, unknown>>);
}

/** Find legacy-named base objects in one tenant without deparsing other schemas. */
async function findLegacyBaseObjects(schema: string) {
  const { sql } = await import("drizzle-orm");
  const P = "(stylist|salon|beauty_bank)";
  return rows(sql`
    WITH target_constraints AS MATERIALIZED (
      SELECT c.oid, c.conname, t.relname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schema}
    ),
    target_indexes AS MATERIALIZED (
      SELECT i.indexrelid AS oid, index_class.relname AS indexname,
        table_class.relname AS tablename
      FROM pg_index i
      JOIN pg_class index_class ON index_class.oid = i.indexrelid
      JOIN pg_class table_class ON table_class.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = table_class.relnamespace
      WHERE n.nspname = ${schema}
    )
    SELECT 'rel ' || c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schema} AND c.relkind = 'r' AND c.relname ~ ${P}
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${schema} AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND (c.relname ~ ${P} OR a.attname ~ ${P})
      AND (c.relname || '.' || a.attname) NOT IN (
        'staff.legacy_stylist_role',
        'appointments.stylist_id',
        'working_hours.stylist_id',
        'calendar_connections.stylist_id',
        'external_events.stylist_id',
        'time_blocks.stylist_id',
        'charges.beauty_bank_cents'
      )
    UNION ALL
    SELECT 'con ' || relname || '.' || conname FROM target_constraints
    WHERE relname ~ ${P} OR conname ~ ${P} OR pg_get_constraintdef(oid) ~ ${P}
    UNION ALL
    SELECT 'idx ' || indexname FROM target_indexes
    WHERE tablename ~ ${P} OR indexname ~ ${P} OR pg_get_indexdef(oid) ~ ${P}
  `);
}

const ID = {
  C1: "00000000-0000-4000-8000-0000000000c1",
  C2: "00000000-0000-4000-8000-0000000000c2",
  S1: "00000000-0000-4000-8000-0000000000e1",
  L1: "00000000-0000-4000-8000-0000000000a1",
  ST1: "00000000-0000-4000-8000-000000000051",
  AS1: "00000000-0000-4000-8000-000000000052",
  A1: "00000000-0000-4000-8000-0000000000b1",
  CC1: "00000000-0000-4000-8000-0000000000d1",
};

async function seedOldNames(schema: string) {
  const { publicDb } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const q = `"${schema}"`;
  const run = (text: string) => publicDb.execute(sql.raw(text));
  await run(`INSERT INTO ${q}.clients (id, name) VALUES ('${ID.C1}', 'Client One'), ('${ID.C2}', 'Client Two')`);
  await run(`INSERT INTO ${q}.services (id, name, default_duration_minutes) VALUES ('${ID.S1}', 'Cut', 60)`);
  await run(`INSERT INTO ${q}.locations (id, name) VALUES ('${ID.L1}', 'Main')`);
  await run(`INSERT INTO ${q}.stylists (id, display_name, role) VALUES ('${ID.ST1}', 'Stylist', 'stylist'), ('${ID.AS1}', 'Assistant', 'assistant')`);
  await run(`UPDATE ${q}.stylists SET default_assistant_id = '${ID.AS1}' WHERE id = '${ID.ST1}'`);
  await run(`INSERT INTO ${q}.stylist_services (stylist_id, service_id, price_cents) VALUES ('${ID.ST1}', '${ID.S1}', 5500)`);
  await run(`INSERT INTO ${q}.working_hours (stylist_id, day_of_week, start_time, end_time, location_id) VALUES ('${ID.ST1}', 1, '09:00', '17:00', '${ID.L1}')`);
  await run(`INSERT INTO ${q}.appointments (id, stylist_id, client_id, service_id, location_id, during) VALUES ('${ID.A1}', '${ID.ST1}', '${ID.C1}', '${ID.S1}', '${ID.L1}', '[2030-01-07 15:00+00,2030-01-07 16:00+00)')`);
  await run(`INSERT INTO ${q}.time_blocks (stylist_id, location_id, during) VALUES ('${ID.ST1}', '${ID.L1}', '[2030-01-07 17:00+00,2030-01-07 18:00+00)')`);
  await run(`INSERT INTO ${q}.calendar_connections (id, stylist_id, platform, access_token, refresh_token, token_expires_at) VALUES ('${ID.CC1}', '${ID.ST1}', 'google', 'a', 'r', '2031-01-01T00:00:00Z')`);
  await run(`INSERT INTO ${q}.external_events (connection_id, stylist_id, calendar_id, start_time, end_time) VALUES ('${ID.CC1}', '${ID.ST1}', 'cal', '2030-01-07T20:00:00Z', '2030-01-07T21:00:00Z')`);
  await run(`INSERT INTO ${q}.salon_policies (salon_address, beauty_bank_expiry_months) VALUES ('1 Main St', 12)`);
  await run(`INSERT INTO ${q}.beauty_bank_transactions (client_id, type, amount_cents, running_balance_cents) VALUES ('${ID.C1}', 'admin_credit', 2500, 2500)`);
  await run(`INSERT INTO ${q}.beauty_bank_balances (client_id, balance_cents) VALUES ('${ID.C1}', 2500)`);
  await run(`INSERT INTO ${q}.charges (appointment_id, client_id, amount_cents, reason, beauty_bank_cents) VALUES ('${ID.A1}', '${ID.C1}', 5500, 'service_payment', 1000)`);
  await run(`INSERT INTO ${q}.assistant_tasks (appointment_id, assigned_to, task_name, during) VALUES ('${ID.A1}', '${ID.AS1}', 'Prep', '[2030-01-07 15:00+00,2030-01-07 15:15+00)')`);
}

/** Row counts of the seeded tables under their OLD names (schema at 39). */
async function oldNameCounts(schema: string) {
  const { sql } = await import("drizzle-orm");
  const tables = ["stylists", "stylist_services", "salon_policies", "beauty_bank_transactions", "beauty_bank_balances", "appointments", "working_hours", "time_blocks", "calendar_connections", "external_events", "charges", "assistant_tasks"];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await rows(sql.raw(`SELECT count(*)::int AS n FROM "${schema}"."${t}"`));
    out[t] = r[0].n as number;
  }
  return out;
}

describe("migration 0040 domain renames (integration)", () => {
  itDb("fresh provision keeps canonical base objects and the explicit 0060 compatibility surface", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { LATEST_SCHEMA_VERSION } = await import("./index");
    const { publicDb } = await import("@/lib/db");
    const { tenants } = await import("@/lib/db/schema");
    const { eq, sql } = await import("drizzle-orm");

    const slug = makeSlug("a");
    const schema = `tenant_${slug}`;
    await provisionTenantSchema({ name: "M40 A", slug });

    const [t] = await publicDb.select().from(tenants).where(eq(tenants.slug, slug));
    expect(t.schemaVersion).toBe(LATEST_SCHEMA_VERSION);

    const legacyBaseObjects = await findLegacyBaseObjects(schema);
    expect(legacyBaseObjects).toEqual([]);

    const compatibilityViews = await rows(sql`
      SELECT c.relname AS name, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schema} AND c.relkind = 'v'
      ORDER BY c.relname
    `);
    expect(compatibilityViews).toEqual([
      { name: "beauty_bank_balances", relkind: "v" },
      { name: "beauty_bank_transactions", relkind: "v" },
      { name: "salon_policies", relkind: "v" },
      { name: "stylist_services", relkind: "v" },
      { name: "stylists", relkind: "v" },
    ]);
  }, 60000);

  itDb("catalog scan stays scoped during unrelated schema DDL churn", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { publicDb } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");

    const targetSlug = makeSlug("scope");
    const churnSlug = makeSlug("churn");
    const targetSchema = `tenant_${targetSlug}`;
    const churnSchema = `tenant_${churnSlug}`;
    await provisionTenantSchema({ name: "M40 Scope", slug: targetSlug });
    await provisionTenantSchema({ name: "M40 Churn", slug: churnSlug });

    const run = (text: string) => publicDb.execute(sql.raw(text));
    // The column name intentionally contains a legacy term; only the
    // constraint and index names are neutral, so their matches come from defs.
    await run(`ALTER TABLE "${targetSchema}"."clients" ADD COLUMN "legacy_stylist_marker" text`);
    await run(`ALTER TABLE "${targetSchema}"."clients" ADD CONSTRAINT "catalog_domain_marker_check" CHECK (name <> 'stylist')`);
    await run(`CREATE INDEX "catalog_domain_expression_idx" ON "${targetSchema}"."clients" USING btree ((lower(name) || 'stylist'))`);

    // The unrelated schema has the same definition-only matches. The exact
    // result assertion proves only target findings are returned; the
    // materialized CTE boundary keeps deparser inputs scoped to this tenant.
    await run(`CREATE TABLE "${churnSchema}"."catalog_churn_seed" (
      marker text,
      CONSTRAINT "catalog_churn_seed_check" CHECK (marker <> 'stylist')
    )`);
    await run(`CREATE INDEX "catalog_churn_seed_idx" ON "${churnSchema}"."catalog_churn_seed" USING btree ((lower(marker) || 'stylist'))`);

    const expected = [
      "col clients.legacy_stylist_marker",
      "con clients.catalog_domain_marker_check",
      "idx catalog_domain_expression_idx",
    ].sort();
    const assertTargetFindings = (findings: Array<Record<string, unknown>>) => {
      expect(findings.map((finding) => finding.name).sort()).toEqual(expected);
    };
    assertTargetFindings(await findLegacyBaseObjects(targetSchema));

    // Start bounded scans and unrelated create/drop DDL together. The test
    // checks every scan succeeds and retains the full target assertion; it
    // does not depend on timing the historical catalog race.
    const scanCount = 16;
    const churnCount = 12;
    let begin!: () => void;
    const start = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const scanTask = (async () => {
      await start;
      for (let i = 0; i < scanCount; i += 1) {
        assertTargetFindings(await findLegacyBaseObjects(targetSchema));
      }
    })();
    const churnTask = (async () => {
      await start;
      for (let i = 0; i < churnCount; i += 1) {
        const table = `catalog_churn_${i}`;
        const index = `${table}_idx`;
        await run(`CREATE TABLE "${churnSchema}"."${table}" (
          marker text,
          CONSTRAINT "${table}_check" CHECK (marker <> 'stylist')
        )`);
        await run(`CREATE INDEX "${index}" ON "${churnSchema}"."${table}" USING btree ((lower(marker) || 'stylist'))`);
        await run(`DROP TABLE "${churnSchema}"."${table}"`);
      }
    })();
    begin();
    const taskResults = await Promise.allSettled([scanTask, churnTask]);
    const failedTask = taskResults.find((result) => result.status === "rejected");
    if (failedTask?.status === "rejected") throw failedTask.reason;
  }, 90000);

  itDb("fresh@LATEST and fresh@39 + migrateTenant have identical fingerprints", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { migrateTenant } = await import("./runner");
    const { LATEST_SCHEMA_VERSION } = await import("./index");
    const { schemaFingerprint } = await import("../schema-fingerprint");

    const a = makeSlug("fa");
    const b = makeSlug("fb");
    await provisionTenantSchema({ name: "M40 FA", slug: a });
    await provisionTenantSchema({ name: "M40 FB", slug: b, throughVersion: 39 });
    const res = await migrateTenant(b, 39);
    expect(res.error).toBeUndefined();
    expect(res.toVersion).toBe(LATEST_SCHEMA_VERSION);

    expect(await schemaFingerprint(`tenant_${b}`)).toEqual(
      await schemaFingerprint(`tenant_${a}`),
    );
  }, 90000);

  itDb("data survives up; constraints still enforce; down restores old names; up-down-up works", async () => {
    const { provisionTenantSchema } = await import("../provision");
    const { migrateTenant, rollbackTenant } = await import("./runner");
    const { LATEST_SCHEMA_VERSION } = await import("./index");
    const { schemaFingerprint } = await import("../schema-fingerprint");
    const { withTenantDb } = await import("@/lib/db/tenant");
    const { publicDb } = await import("@/lib/db");
    const { tenants } = await import("@/lib/db/schema");
    const { eq, sql } = await import("drizzle-orm");

    const slug = makeSlug("c");
    const schema = `tenant_${slug}`;
    await provisionTenantSchema({ name: "M40 C", slug, throughVersion: 39 });
    await seedOldNames(schema);

    const fp39 = await schemaFingerprint(schema);
    const counts39 = await oldNameCounts(schema);

    const up = await migrateTenant(slug, 39);
    expect(up.error).toBeUndefined();
    expect(up.toVersion).toBe(LATEST_SCHEMA_VERSION);

    await withTenantDb(slug, async (db, t) => {
      const staff = await db.select().from(t.staff);
      expect(staff.find((s) => s.id === ID.ST1)?.role).toBe("provider");
      expect(staff.find((s) => s.id === ID.AS1)?.role).toBe("assistant");
      expect(staff.find((s) => s.id === ID.ST1)?.defaultAssistantId).toBe(ID.AS1);

      expect((await db.select().from(t.staffServices))[0].priceCents).toBe(5500);
      for (const table of [t.workingHours, t.appointments, t.timeBlocks, t.calendarConnections, t.externalEvents]) {
        const r = await db.select({ staffId: table.staffId }).from(table);
        expect(r).toHaveLength(1);
        expect(r[0].staffId).toBe(ID.ST1);
      }

      const [bs] = await db.select().from(t.businessSettings);
      expect(bs.businessAddress).toBe("1 Main St");
      expect(bs.storedValueExpiryMonths).toBe(12);

      const txns = await db.select().from(t.storedValueTransactions);
      expect(txns).toHaveLength(1);
      expect(txns[0].amountCents).toBe(2500);
      expect((await db.select().from(t.storedValueBalances))[0].balanceCents).toBe(2500);
      expect((await db.select().from(t.charges))[0].storedValueCents).toBe(1000);
      expect((await db.select().from(t.assistantTasks))[0].assignedTo).toBe(ID.AS1);

      // New rows get the new role default.
      const [fresh] = await db.insert(t.staff).values({ displayName: "Default Role" }).returning();
      expect(fresh.role).toBe("provider");
    });

    const q = `"${schema}"`;
    const run = (text: string) => publicDb.execute(sql.raw(text));
    // Overlapping appointment for the same staff + location -> exclusion violation.
    await expect(
      run(`INSERT INTO ${q}.appointments (staff_id, client_id, service_id, location_id, during) VALUES ('${ID.ST1}', '${ID.C2}', '${ID.S1}', '${ID.L1}', '[2030-01-07 15:30+00,2030-01-07 16:30+00)')`),
    ).rejects.toSatisfy((e) => pgCode(e) === "23P01");
    // Overlapping time block -> exclusion violation.
    await expect(
      run(`INSERT INTO ${q}.time_blocks (staff_id, location_id, during) VALUES ('${ID.ST1}', '${ID.L1}', '[2030-01-07 17:30+00,2030-01-07 18:30+00)')`),
    ).rejects.toSatisfy((e) => pgCode(e) === "23P01");
    // FK still enforced after the rename.
    await expect(
      run(`INSERT INTO ${q}.staff_services (staff_id, service_id) VALUES (gen_random_uuid(), '${ID.S1}')`),
    ).rejects.toSatisfy((e) => pgCode(e) === "23503");

    const defs = await rows(sql`
      SELECT c.conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = ${schema} AND c.conname IN ('appointments_no_overlap', 'time_blocks_no_overlap')`);
    expect(defs).toHaveLength(2);
    for (const d of defs) {
      expect(d.def).toContain("staff_id");
      expect(d.def).not.toContain("stylist_id");
    }

    // Remove the row inserted by the default-role check so counts match the seeded state.
    await run(`DELETE FROM ${q}.staff WHERE display_name = 'Default Role'`);

    // Down restores the old names.
    const down = await rollbackTenant(slug, LATEST_SCHEMA_VERSION, 39);
    expect(down.error).toBeUndefined();
    expect(down.toVersion).toBe(39);
    const [tenant] = await publicDb.select().from(tenants).where(eq(tenants.slug, slug));
    expect(tenant.schemaVersion).toBe(39);
    expect(await schemaFingerprint(schema)).toEqual(fp39);
    expect((await rows(sql.raw(`SELECT role FROM ${q}.stylists WHERE id = '${ID.ST1}'`)))[0].role).toBe("stylist");
    expect(await oldNameCounts(schema)).toEqual(counts39);

    // up -> down -> up
    const again = await migrateTenant(slug, 39);
    expect(again.error).toBeUndefined();
    expect(again.toVersion).toBe(LATEST_SCHEMA_VERSION);
    const [tenant2] = await publicDb.select().from(tenants).where(eq(tenants.slug, slug));
    expect(tenant2.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect((await rows(sql.raw(`SELECT role FROM ${q}.staff WHERE id = '${ID.ST1}'`)))[0].role).toBe("provider");
  }, 120000);
});
