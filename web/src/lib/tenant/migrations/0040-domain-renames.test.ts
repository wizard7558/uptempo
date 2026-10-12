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
  itDb("fresh provision lands at LATEST with no legacy names", async () => {
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

    const P = "(stylist|salon|beauty_bank)";
    const legacy = await rows(sql`
      SELECT 'col ' || table_name || '.' || column_name AS name FROM information_schema.columns
        WHERE table_schema = ${schema} AND (table_name ~ ${P} OR column_name ~ ${P} OR column_default ~ ${P})
      UNION ALL
      SELECT 'con ' || t.relname || '.' || c.conname FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = ${schema} AND (t.relname ~ ${P} OR c.conname ~ ${P} OR pg_get_constraintdef(c.oid) ~ ${P})
      UNION ALL
      SELECT 'idx ' || indexname FROM pg_indexes
        WHERE schemaname = ${schema} AND (tablename ~ ${P} OR indexname ~ ${P} OR indexdef ~ ${P})
    `);
    expect(legacy).toEqual([]);
  }, 60000);

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
