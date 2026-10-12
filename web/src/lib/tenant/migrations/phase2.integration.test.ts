// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";

const itDb = process.env.DATABASE_URL ? it : it.skip;

/** Last schema version before the Phase 2 migrations (0042 onward). */
const PHASE2_BASE = 41;

const slugs: string[] = [];
const makeSlug = (tag: string) => {
  const slug = `p2${tag}${Date.now()}${Math.floor(Math.random() * 1000)}`;
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

describe("Phase 2 migrations (integration)", () => {
  itDb(
    "fresh@LATEST equals fresh@base + migrate; down returns to base; up again returns to LATEST",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { schemaFingerprint } = await import("../schema-fingerprint");

      const a = makeSlug("a");
      const b = makeSlug("b");
      await provisionTenantSchema({ name: "P2 A", slug: a });
      await provisionTenantSchema({ name: "P2 B", slug: b, throughVersion: PHASE2_BASE });
      const fpA = await schemaFingerprint(`tenant_${a}`);
      const fpBase = await schemaFingerprint(`tenant_${b}`);
      expect(fpBase).not.toEqual(fpA);

      const up = await migrateTenant(b, PHASE2_BASE);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpA);

      const down = await rollbackTenant(b, LATEST_SCHEMA_VERSION, PHASE2_BASE);
      expect(down.error).toBeUndefined();
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpBase);

      const again = await migrateTenant(b, PHASE2_BASE);
      expect(again.error).toBeUndefined();
      expect(again.toVersion).toBe(LATEST_SCHEMA_VERSION);
      expect(await schemaFingerprint(`tenant_${b}`)).toEqual(fpA);
    },
    120_000,
  );

  itDb(
    "0042 sets same_day_booking = 0 on existing rows; new rows get the column defaults",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant } = await import("./runner");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");

      const slug = makeSlug("d");
      const schema = `tenant_${slug}`;
      await provisionTenantSchema({ name: "P2 D", slug, throughVersion: PHASE2_BASE });
      await publicDb.execute(
        sql.raw(`INSERT INTO "${schema}".business_settings (timezone) VALUES ('America/Chicago')`),
      );

      const res = await migrateTenant(slug, PHASE2_BASE);
      expect(res.error).toBeUndefined();

      const read = async () =>
        Array.from(
          (await publicDb.execute(
            sql.raw(
              `SELECT timezone, same_day_booking, min_notice_minutes, max_advance_days, slot_interval_minutes FROM "${schema}".business_settings ORDER BY created_at`,
            ),
          )) as Iterable<Record<string, unknown>>,
        );
      const rows = await read();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        timezone: "America/Chicago",
        same_day_booking: 0,
        min_notice_minutes: 120,
        max_advance_days: 28,
        slot_interval_minutes: 15,
      });

      // A row inserted after the migration gets same-day on.
      await publicDb.execute(sql.raw(`INSERT INTO "${schema}".business_settings (timezone) VALUES ('UTC')`));
      const after = (await read()).find((r) => r.timezone === "UTC");
      expect(after).toMatchObject({ same_day_booking: 1, min_notice_minutes: 120 });

      // The CHECK constraints are enforced.
      await expect(
        publicDb.execute(
          sql.raw(`UPDATE "${schema}".business_settings SET slot_interval_minutes = 25`),
        ),
      ).rejects.toThrow();
    },
    120_000,
  );

  itDb(
    "0043 allows split shifts; its down keeps one shift per day (enabled first) and restores the unique constraint",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { migrateTenant, rollbackTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");

      const slug = makeSlug("e");
      const schema = `tenant_${slug}`;
      await provisionTenantSchema({ name: "P2 E", slug, throughVersion: PHASE2_BASE });
      const up = await migrateTenant(slug, PHASE2_BASE);
      expect(up.error).toBeUndefined();
      expect(up.toVersion).toBe(LATEST_SCHEMA_VERSION);

      const run = async (q: string) =>
        Array.from((await publicDb.execute(sql.raw(q))) as Iterable<Record<string, unknown>>);
      const [staff] = await run(`INSERT INTO "${schema}".staff (display_name) VALUES ('S') RETURNING id`);
      const hours = (day: number, start: string, end: string, enabled: number) =>
        run(
          `INSERT INTO "${schema}".working_hours (staff_id, day_of_week, start_time, end_time, is_enabled) VALUES ('${staff.id}', ${day}, '${start}', '${end}', ${enabled})`,
        );
      // Monday: two enabled shifts. Tuesday: a closed row and an enabled shift.
      await hours(1, "14:00", "17:00", 1);
      await hours(1, "09:00", "12:00", 1);
      await hours(2, "06:00", "07:00", 0);
      await hours(2, "10:00", "15:00", 1);

      const down = await rollbackTenant(slug, LATEST_SCHEMA_VERSION, 42);
      expect(down.error).toBeUndefined();

      const rows = await run(
        `SELECT day_of_week, start_time, is_enabled FROM "${schema}".working_hours ORDER BY day_of_week`,
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ day_of_week: 1, start_time: "09:00", is_enabled: 1 });
      expect(rows[1]).toMatchObject({ day_of_week: 2, start_time: "10:00", is_enabled: 1 });

      const constraints = await run(
        `SELECT conname FROM pg_constraint WHERE conrelid = '"${schema}".working_hours'::regclass AND contype = 'u'`,
      );
      expect(constraints.map((c) => c.conname)).toContain("working_hours_staff_day_unique");
      await expect(hours(1, "13:00", "14:00", 1)).rejects.toThrow();

      const tables = await run(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = 'availability_overrides'`,
      );
      expect(tables).toHaveLength(0);
    },
    120_000,
  );

  itDb(
    "0044 sets is_exclusive from capacity; its down removes the tables, functions and triggers",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { rollbackTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");

      const slug = makeSlug("f");
      const schema = `tenant_${slug}`;
      await provisionTenantSchema({ name: "P2 F", slug });
      const run = async (q: string) =>
        Array.from((await publicDb.execute(sql.raw(q))) as Iterable<Record<string, unknown>>);

      const [staff] = await run(`INSERT INTO "${schema}".staff (display_name) VALUES ('S') RETURNING id`);
      const [client] = await run(`INSERT INTO "${schema}".clients (name) VALUES ('C') RETURNING id`);
      const [one] = await run(`INSERT INTO "${schema}".resources (kind, name) VALUES ('chair', 'One') RETURNING id`);
      const [many] = await run(
        `INSERT INTO "${schema}".resources (kind, name, capacity) VALUES ('chair', 'Many', 3) RETURNING id`,
      );
      const [appt] = await run(
        `INSERT INTO "${schema}".appointments (staff_id, client_id, during) VALUES ('${staff.id}','${client.id}', tstzrange('2026-06-17T14:00Z','2026-06-17T15:00Z','[)')) RETURNING id`,
      );
      // The caller says 0 for a capacity-1 resource and 1 for a capacity-3 resource; the database overrides both.
      await run(
        `INSERT INTO "${schema}".appointment_resources (appointment_id, resource_id, during, is_exclusive) VALUES ('${appt.id}','${one.id}', tstzrange('2026-06-17T14:00Z','2026-06-17T15:00Z','[)'), 0), ('${appt.id}','${many.id}', tstzrange('2026-06-17T14:00Z','2026-06-17T15:00Z','[)'), 1)`,
      );
      const rows = await run(
        `SELECT r.name, ar.is_exclusive FROM "${schema}".appointment_resources ar JOIN "${schema}".resources r ON r.id = ar.resource_id ORDER BY r.name`,
      );
      expect(rows).toEqual([
        { name: "Many", is_exclusive: 0 },
        { name: "One", is_exclusive: 1 },
      ]);

      const down = await rollbackTenant(slug, LATEST_SCHEMA_VERSION, 43);
      expect(down.error).toBeUndefined();
      const gone = await run(
        `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name IN ('resources','service_resource_requirements','appointment_resources'))::int AS tables,
                (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = '${schema}' AND p.proname IN ('appointment_resources_guard','appointments_release_resources'))::int AS functions,
                (SELECT count(*) FROM pg_trigger WHERE tgname = 'appointments_release_resources_trg' AND tgrelid = '"${schema}".appointments'::regclass)::int AS triggers`,
      );
      expect(gone[0]).toEqual({ tables: 0, functions: 0, triggers: 0 });
    },
    120_000,
  );

  itDb(
    "0045 adds group bookings; its down removes the table and both columns; it can run again",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { rollbackTenant, migrateTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");

      const slug = makeSlug("g");
      const schema = `tenant_${slug}`;
      await provisionTenantSchema({ name: "P2 G", slug });
      const run = async (q: string) =>
        Array.from((await publicDb.execute(sql.raw(q))) as Iterable<Record<string, unknown>>);
      const shape = () =>
        run(
          `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = 'booking_groups')::int AS tables,
                  (SELECT count(*) FROM information_schema.columns WHERE table_schema = '${schema}' AND column_name = 'booking_group_id' AND table_name IN ('appointments','charges'))::int AS columns`,
        );
      expect((await shape())[0]).toEqual({ tables: 1, columns: 2 });

      // The kind check is enforced.
      const [client] = await run(`INSERT INTO "${schema}".clients (name) VALUES ('C') RETURNING id`);
      await expect(
        run(`INSERT INTO "${schema}".booking_groups (client_id, kind) VALUES ('${client.id}', 'nope')`),
      ).rejects.toThrow();

      const down = await rollbackTenant(slug, LATEST_SCHEMA_VERSION, 44);
      expect(down.error).toBeUndefined();
      expect((await shape())[0]).toEqual({ tables: 0, columns: 0 });

      const up = await migrateTenant(slug, 44);
      expect(up.error).toBeUndefined();
      expect((await shape())[0]).toEqual({ tables: 1, columns: 2 });
    },
    120_000,
  );
  itDb(
    "0046 adds recurring bookings; its checks and unique index hold; its down removes them; it can run again",
    async () => {
      const { provisionTenantSchema } = await import("../provision");
      const { rollbackTenant, migrateTenant } = await import("./runner");
      const { LATEST_SCHEMA_VERSION } = await import("./index");
      const { publicDb } = await import("@/lib/db");
      const { sql } = await import("drizzle-orm");

      const slug = makeSlug("r");
      const schema = `tenant_${slug}`;
      await provisionTenantSchema({ name: "P2 R", slug });
      const run = async (q: string) =>
        Array.from((await publicDb.execute(sql.raw(q))) as Iterable<Record<string, unknown>>);
      const shape = () =>
        run(
          `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = 'recurrence_rules')::int AS tables,
                  (SELECT count(*) FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = 'appointments' AND column_name IN ('recurrence_rule_id','recurrence_index'))::int AS columns,
                  (SELECT count(*) FROM pg_indexes WHERE schemaname = '${schema}' AND indexname = 'appointments_recurrence_unique')::int AS indexes`,
        );
      expect((await shape())[0]).toEqual({ tables: 1, columns: 2, indexes: 1 });

      const [staff] = await run(`INSERT INTO "${schema}".staff (display_name) VALUES ('S') RETURNING id`);
      const [client] = await run(`INSERT INTO "${schema}".clients (name) VALUES ('C') RETURNING id`);
      const [loc] = await run(`SELECT id FROM "${schema}".locations LIMIT 1`);
      const rule = (rrule: string, count: string) =>
        `INSERT INTO "${schema}".recurrence_rules (rrule, starts_at, count, timezone, staff_id, client_id, service_ids)
         VALUES ('${rrule}', now(), ${count}, 'UTC', '${staff.id}', '${client.id}', '["x"]'::jsonb) RETURNING id`;
      await expect(run(rule("FREQ=DAILY;INTERVAL=1", "null"))).rejects.toThrow();
      await expect(run(rule("FREQ=WEEKLY;INTERVAL=1", "1"))).rejects.toThrow();
      const [ok] = await run(rule("FREQ=WEEKLY;INTERVAL=2", "4"));

      const visit = `INSERT INTO "${schema}".appointments (staff_id, client_id, location_id, during, recurrence_rule_id, recurrence_index)
        VALUES ('${staff.id}', '${client.id}', '${loc.id}', tstzrange('2030-01-01T10:00Z','2030-01-01T11:00Z','[)'), '${ok.id}', 0)`;
      await run(visit);
      // The same visit cannot be booked twice.
      await expect(
        run(visit.replace("2030-01-01T10:00Z", "2030-01-02T10:00Z").replace("2030-01-01T11:00Z", "2030-01-02T11:00Z")),
      ).rejects.toThrow();

      const down = await rollbackTenant(slug, LATEST_SCHEMA_VERSION, 45);
      expect(down.error).toBeUndefined();
      expect((await shape())[0]).toEqual({ tables: 0, columns: 0, indexes: 0 });

      const up = await migrateTenant(slug, 45);
      expect(up.error).toBeUndefined();
      expect((await shape())[0]).toEqual({ tables: 1, columns: 2, indexes: 1 });
    },
    120_000,
  );
});
