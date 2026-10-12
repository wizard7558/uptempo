// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { ScratchTenant } from "./db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;

const NOW = new Date("2026-06-10T12:00:00Z");
const DAY = "2026-06-17"; // Wednesday, EDT (UTC-4)

const tenants: ScratchTenant[] = [];

afterAll(async () => {
  for (const t of tenants) await t.drop();
});

const range = (a: string, b: string) => `tstzrange('${a}','${b}','[)')`;
const iso = (d: Date) => d.toISOString();

describe("scheduling service against a real tenant schema (Scenario A)", () => {
  let t: ScratchTenant;
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("./db-fixtures");
    t = await scratchTenant("scena");
    tenants.push(t);
    const s = `"${t.schema}"`;
    const one = async (q: string) => String((await t.run(q))[0].id);

    ids.l1 = await one(`select id from ${s}.locations order by created_at limit 1`);
    ids.l2 = await one(`insert into ${s}.locations (name) values ('Second') returning id`);
    ids.s1 = await one(`insert into ${s}.staff (display_name) values ('S1') returning id`);
    ids.client = await one(`insert into ${s}.clients (name) values ('C') returning id`);
    ids.haircut = await one(
      `insert into ${s}.services (name, default_duration_minutes) values ('Haircut', 30) returning id`,
    );
    ids.host = await one(
      `insert into ${s}.services (name, default_duration_minutes, active_minutes, processing_minutes) values ('Host', 75, 45, 30) returning id`,
    );
    await t.run(
      `insert into ${s}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${ids.s1}', 3, '09:00', '17:00', 1, '${ids.l1}')`,
    );

    // Host appointment H 09:00-10:15 EDT at L1, line item with a 45/30 split.
    ids.h = await one(
      `insert into ${s}.appointments (staff_id, client_id, location_id, during) values ('${ids.s1}','${ids.client}','${ids.l1}', ${range("2026-06-17T13:00:00Z", "2026-06-17T14:15:00Z")}) returning id`,
    );
    await t.run(
      `insert into ${s}.appointment_services (appointment_id, service_id, duration_minutes, active_minutes, processing_minutes) values ('${ids.h}','${ids.host}',75,45,30)`,
    );
    // Cancelled 10:15-11:00 (ignored).
    await t.run(
      `insert into ${s}.appointments (staff_id, client_id, location_id, during, status) values ('${ids.s1}','${ids.client}','${ids.l1}', ${range("2026-06-17T14:15:00Z", "2026-06-17T15:00:00Z")}, 'cancelled')`,
    );
    // 14:00-15:00 EDT at L2 (a different lane, must not block L1).
    await t.run(
      `insert into ${s}.appointments (staff_id, client_id, location_id, during) values ('${ids.s1}','${ids.client}','${ids.l2}', ${range("2026-06-17T18:00:00Z", "2026-06-17T19:00:00Z")})`,
    );
    // Time block 12:00-13:00 EDT at L1.
    await t.run(
      `insert into ${s}.time_blocks (staff_id, location_id, during) values ('${ids.s1}','${ids.l1}', ${range("2026-06-17T16:00:00Z", "2026-06-17T17:00:00Z")})`,
    );
    // External event 15:00-15:30 EDT.
    const conn = await one(
      `insert into ${s}.calendar_connections (staff_id, platform, access_token, refresh_token, token_expires_at) values ('${ids.s1}','google_calendar','x','x', now()) returning id`,
    );
    await t.run(
      `insert into ${s}.external_events (connection_id, staff_id, calendar_id, start_time, end_time) values ('${conn}','${ids.s1}','cal','2026-06-17T19:00:00Z','2026-06-17T19:30:00Z')`,
    );
    // Pending task 16:00-16:15 EDT.
    await t.run(
      `insert into ${s}.assistant_tasks (assigned_to, task_name, during, status) values ('${ids.s1}','prep', ${range("2026-06-17T20:00:00Z", "2026-06-17T20:15:00Z")}, 'pending')`,
    );
  }, 120_000);

  const NORMAL = [
    "14:15", "14:30", "14:45", "15:00", "15:15", "15:30",
    "17:00", "17:15", "17:30", "17:45", "18:00", "18:15", "18:30",
    "19:30", "20:15", "20:30",
  ].map((h) => `2026-06-17T${h}:00.000Z`);

  itDb(
    "listDaySlots returns the flex slot in the host gap and the exact normal slots",
    async () => {
      const { listDaySlots } = await import("./service");
      const slots = await listDaySlots({
        slug: t.slug,
        staffId: ids.s1,
        locationId: ids.l1,
        serviceIds: [ids.haircut],
        clientId: null,
        day: DAY,
        now: NOW,
      });
      const flex = slots.filter((x) => x.isFlex);
      expect(flex.map((x) => iso(x.start))).toEqual(["2026-06-17T13:45:00.000Z"]);
      expect(flex[0].hostAppointmentId).toBe(ids.h);
      expect(slots.filter((x) => !x.isFlex).map((x) => iso(x.start))).toEqual(NORMAL);
      console.info("Scenario A slots (UTC):", slots.map((x) => iso(x.start)));
    },
    60_000,
  );

  itDb(
    "a flex child on the host removes the flex slot and leaves normal slots unchanged",
    async () => {
      const s = `"${t.schema}"`;
      const child = String(
        (
          await t.run(
            `insert into ${s}.appointments (staff_id, client_id, location_id, during, is_double_book, double_book_parent_appointment_id) values ('${ids.s1}','${ids.client}','${ids.l1}', ${range("2026-06-17T13:45:00Z", "2026-06-17T14:15:00Z")}, 1, '${ids.h}') returning id`,
          )
        )[0].id,
      );
      try {
        const { listDaySlots } = await import("./service");
        const slots = await listDaySlots({
          slug: t.slug,
          staffId: ids.s1,
          locationId: ids.l1,
          serviceIds: [ids.haircut],
          clientId: null,
          day: DAY,
          now: NOW,
        });
        expect(slots.some((x) => x.isFlex)).toBe(false);
        expect(slots.map((x) => iso(x.start))).toEqual(NORMAL);
      } finally {
        await t.run(`delete from ${s}.appointments where id = '${child}'`);
      }
    },
    60_000,
  );

  itDb(
    "listBookableDays skips today (legacy no-same-day rule) and includes the next open Wednesday",
    async () => {
      const { listBookableDays } = await import("./service");
      const days = await listBookableDays({
        slug: t.slug,
        staffId: ids.s1,
        locationId: ids.l1,
        serviceIds: [ids.haircut],
        clientId: null,
        now: NOW,
      });
      expect(days).not.toContain("2026-06-10");
      expect(days).toContain("2026-06-17");
      expect(days).toContain("2026-06-24");
      // Only Wednesdays have hours.
      expect(days.every((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 3)).toBe(true);
    },
    60_000,
  );

  itDb(
    "checkBooking honours the mode: reschedule/override see blocks, override ignores appointments",
    async () => {
      const { checkBooking } = await import("./service");
      const base = {
        slug: t.slug,
        staffId: ids.s1,
        services: [{ serviceId: ids.haircut, durationMinutes: 30 }],
        totalMinutes: 30,
        locationId: ids.l1,
        now: NOW,
      };
      // 12:00 EDT is inside the block.
      const resched = await checkBooking({
        ...base,
        mode: "reschedule",
        start: new Date("2026-06-17T16:00:00Z"),
      });
      expect(resched).toEqual({ ok: false, reasons: ["BUSY_BLOCK"] });

      // 14:15 EDT is free of blocks.
      const free = await checkBooking({
        ...base,
        mode: "override",
        start: new Date("2026-06-17T18:15:00Z"),
      });
      expect(free).toEqual({ ok: true, resources: [] });

      // 09:15 EDT is inside the host appointment: override ignores appointments.
      const overHost = await checkBooking({
        ...base,
        mode: "override",
        start: new Date("2026-06-17T13:15:00Z"),
      });
      expect(overHost.ok).toBe(true);

      // 12:15 EDT is inside the block: override still refuses.
      const overBlock = await checkBooking({
        ...base,
        mode: "override",
        start: new Date("2026-06-17T16:15:00Z"),
      });
      expect(overBlock).toEqual({ ok: false, reasons: ["BUSY_BLOCK"] });

      // Public mode at 09:15 EDT sees the host appointment.
      const pub = await checkBooking({
        ...base,
        mode: "public",
        start: new Date("2026-06-17T13:15:00Z"),
      });
      expect(pub.ok).toBe(false);
      if (!pub.ok) expect(pub.reasons).toContain("BUSY_APPOINTMENT");

      // Public mode accepts the flex start inside the host's gap.
      const flex = await checkBooking({
        ...base,
        mode: "public",
        start: new Date("2026-06-17T13:45:00Z"),
      });
      expect(flex.ok).toBe(true);

      // Rescheduling the host over itself ignores the excluded appointment.
      const self = await checkBooking({
        ...base,
        totalMinutes: 75,
        mode: "reschedule",
        start: new Date("2026-06-17T13:00:00Z"),
        excludeAppointmentIds: [ids.h],
      });
      expect(self.ok).toBe(true);
    },
    60_000,
  );

  itDb(
    "an offered waitlist row blocks public slots until it expires, and override ignores it",
    async () => {
      const s = `"${t.schema}"`;
      const holdId = String(
        (
          await t.run(
            `insert into ${s}.slot_waitlist (
               client_id, service_ids, date_from, date_to, status,
               offer_token_hash, offer_expires_at, offered_staff_id, offered_start, offered_end
             ) values (
               '${ids.client}', '["${ids.haircut}"]'::jsonb, '2026-06-17', '2026-06-17', 'offered',
               '${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}',
               '2026-06-10T12:15:00Z', '${ids.s1}',
               '2026-06-17T18:00:00Z', '2026-06-17T18:30:00Z'
             ) returning id`,
          )
        )[0].id,
      );
      try {
        const { listDaySlots, checkBooking } = await import("./service");
        const held = await listDaySlots({
          slug: t.slug,
          staffId: ids.s1,
          locationId: ids.l1,
          serviceIds: [ids.haircut],
          clientId: null,
          day: DAY,
          now: NOW,
        });
        const starts = held.filter((x) => !x.isFlex).map((x) => iso(x.start));
        expect(starts).not.toContain("2026-06-17T17:45:00.000Z");
        expect(starts).not.toContain("2026-06-17T18:00:00.000Z");
        expect(starts).not.toContain("2026-06-17T18:15:00.000Z");
        expect(starts).toContain("2026-06-17T18:30:00.000Z");

        const base = {
          slug: t.slug,
          staffId: ids.s1,
          services: [{ serviceId: ids.haircut, durationMinutes: 30 }],
          totalMinutes: 30,
          locationId: ids.l1,
          start: new Date("2026-06-17T18:00:00Z"),
          now: NOW,
        };
        const blocked = await checkBooking({ ...base, mode: "public" });
        expect(blocked).toEqual({ ok: false, reasons: ["BUSY_BLOCK"] });
        const claimed = await checkBooking({
          ...base,
          mode: "public",
          ignoreHoldIds: [holdId],
        });
        expect(claimed).toEqual({ ok: true, resources: [] });
        const override = await checkBooking({ ...base, mode: "override" });
        expect(override).toEqual({ ok: true, resources: [] });

        const expired = await listDaySlots({
          slug: t.slug,
          staffId: ids.s1,
          locationId: ids.l1,
          serviceIds: [ids.haircut],
          clientId: null,
          day: DAY,
          now: new Date("2026-06-10T12:16:00Z"),
        });
        const after = expired.filter((x) => !x.isFlex).map((x) => iso(x.start));
        expect(after).toContain("2026-06-17T17:45:00.000Z");
        expect(after).toContain("2026-06-17T18:00:00.000Z");
        expect(after).toContain("2026-06-17T18:15:00.000Z");
      } finally {
        await t.run(`delete from ${s}.slot_waitlist where id = '${holdId}'`);
      }
    },
    60_000,
  );

  itDb(
    "pgErrorInfo reads 23P01 through the real DrizzleQueryError cause",
    async () => {
      const { withTenantDb } = await import("@/lib/db/tenant");
      const { pgErrorInfo } = await import("@/lib/db/pg-error");
      let caught: unknown;
      try {
        await withTenantDb(t.slug, async (db, { appointments }) => {
          await db.insert(appointments).values({
            staffId: ids.s1,
            clientId: ids.client,
            locationId: ids.l1,
            // Overlaps the host appointment (09:00-10:15 EDT) in the same lane.
            during: {
              start: new Date("2026-06-17T13:30:00Z"),
              end: new Date("2026-06-17T14:00:00Z"),
            },
          });
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      // Drizzle wraps the driver error: the code is not on the top-level error.
      expect((caught as { code?: string }).code).toBeUndefined();
      expect(pgErrorInfo(caught)).toEqual({
        code: "23P01",
        constraint: "appointments_no_overlap",
      });
    },
    60_000,
  );

  itDb(
    "findBusyConflicts reports appointments and blocks in range",
    async () => {
      const { findBusyConflicts } = await import("./service");
      const q = {
        slug: t.slug,
        staffId: ids.s1,
        locationId: ids.l1,
        kinds: ["appointment", "block"] as const,
      };
      const hit = await findBusyConflicts({
        ...q,
        start: new Date("2026-06-17T15:30:00Z"),
        end: new Date("2026-06-17T16:30:00Z"),
      });
      expect(hit.map((b) => b.kind)).toEqual(["block"]);
      const miss = await findBusyConflicts({
        ...q,
        start: new Date("2026-06-17T17:00:00Z"),
        end: new Date("2026-06-17T18:00:00Z"),
      });
      expect(miss).toEqual([]);
    },
    60_000,
  );

  itDb(
    "a buffer-after on the host's service moves the first normal slot from 10:15 to 10:30",
    async () => {
      const s = `"${t.schema}"`;
      const { listDaySlots } = await import("./service");
      const q = {
        slug: t.slug,
        staffId: ids.s1,
        locationId: ids.l1,
        serviceIds: [ids.haircut],
        clientId: null,
        day: DAY,
        now: NOW,
      };
      const before = (await listDaySlots(q)).filter((x) => !x.isFlex);
      expect(iso(before[0].start)).toBe("2026-06-17T14:15:00.000Z");

      await t.run(`update ${s}.services set buffer_after_min = 15 where id = '${ids.host}'`);
      try {
        const after = (await listDaySlots(q)).filter((x) => !x.isFlex);
        expect(iso(after[0].start)).toBe("2026-06-17T14:30:00.000Z");
        // Only the slot touching H changed.
        expect(after.map((x) => iso(x.start))).toEqual(NORMAL.slice(1));
      } finally {
        await t.run(`update ${s}.services set buffer_after_min = 0 where id = '${ids.host}'`);
      }
    },
    60_000,
  );

  itDb(
    "the booked service's own prep time keeps it clear of the previous appointment",
    async () => {
      const s = `"${t.schema}"`;
      const { listDaySlots, checkBooking } = await import("./service");
      await t.run(`update ${s}.services set buffer_before_min = 15 where id = '${ids.haircut}'`);
      try {
        const slots = (
          await listDaySlots({
            slug: t.slug,
            staffId: ids.s1,
            locationId: ids.l1,
            serviceIds: [ids.haircut],
            clientId: null,
            day: DAY,
            now: NOW,
          })
        ).filter((x) => !x.isFlex);
        expect(iso(slots[0].start)).toBe("2026-06-17T14:30:00.000Z");

        const base = {
          slug: t.slug,
          staffId: ids.s1,
          services: [{ serviceId: ids.haircut, durationMinutes: 30 }],
          totalMinutes: 30,
          locationId: ids.l1,
          mode: "reschedule" as const,
          now: NOW,
        };
        const tooClose = await checkBooking({ ...base, start: new Date("2026-06-17T14:15:00Z") });
        expect(tooClose.ok).toBe(false);
        const fine = await checkBooking({ ...base, start: new Date("2026-06-17T14:30:00Z") });
        expect(fine.ok).toBe(true);
      } finally {
        await t.run(`update ${s}.services set buffer_before_min = 0 where id = '${ids.haircut}'`);
      }
    },
    60_000,
  );
});

describe("booking rules from business_settings", () => {
  // now = 09:00 EDT on Wednesday 2026-06-17.
  const RULES_NOW = new Date("2026-06-17T13:00:00Z");

  async function setup(tag: string) {
    const { scratchTenant } = await import("./db-fixtures");
    const t = await scratchTenant(tag);
    tenants.push(t);
    const s = `"${t.schema}"`;
    const one = async (q: string) => String((await t.run(q))[0].id);
    const loc = await one(`select id from ${s}.locations order by created_at limit 1`);
    const staff = await one(`insert into ${s}.staff (display_name) values ('S') returning id`);
    const svc = await one(
      `insert into ${s}.services (name, default_duration_minutes) values ('Cut', 30) returning id`,
    );
    await t.run(
      `insert into ${s}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${staff}', 3, '09:00', '17:00', 1, '${loc}')`,
    );
    await t.run(`insert into ${s}.business_settings (timezone) values ('America/New_York')`);
    return { t, s, loc, staff, svc };
  }
  const query = (x: Awaited<ReturnType<typeof setup>>, extra: object = {}) => ({
    slug: x.t.slug,
    staffId: x.staff,
    locationId: x.loc,
    serviceIds: [x.svc],
    clientId: null,
    now: RULES_NOW,
    ...extra,
  });

  itDb(
    "same-day on with 120 minutes' notice: today's first slot is 11:00 local",
    async () => {
      const { listDaySlots, listBookableDays } = await import("./service");
      const x = await setup("rulesa");
      await x.t.run(
        `update ${x.s}.business_settings set same_day_booking = 1, min_notice_minutes = 120`,
      );
      const slots = await listDaySlots({ ...query(x), day: "2026-06-17" });
      expect(iso(slots[0].start)).toBe("2026-06-17T15:00:00.000Z");
      expect(await listBookableDays(query(x))).toContain("2026-06-17");
    },
    120_000,
  );

  itDb(
    "same-day off: today is not bookable, next week is",
    async () => {
      const { listDaySlots, listBookableDays } = await import("./service");
      const x = await setup("rulesb");
      await x.t.run(`update ${x.s}.business_settings set same_day_booking = 0`);
      expect(await listDaySlots({ ...query(x), day: "2026-06-17" })).toEqual([]);
      const days = await listBookableDays(query(x));
      expect(days).not.toContain("2026-06-17");
      expect(days).toContain("2026-06-24");
    },
    120_000,
  );

  itDb(
    "max_advance_days limits the horizon: 7 reaches 2026-06-24 but not 07-01, 6 stops before 06-24",
    async () => {
      const { listBookableDays } = await import("./service");
      const x = await setup("rulesc");
      await x.t.run(
        `update ${x.s}.business_settings set same_day_booking = 1, max_advance_days = 7`,
      );
      const week = await listBookableDays(query(x));
      expect(week).toEqual(["2026-06-17", "2026-06-24"]);
      await x.t.run(`update ${x.s}.business_settings set max_advance_days = 6`);
      expect(await listBookableDays(query(x))).toEqual(["2026-06-17"]);
    },
    120_000,
  );

  itDb(
    "public checkBooking allows a 10-minute grace at the notice boundary; admin override ignores notice",
    async () => {
      const { checkBooking } = await import("./service");
      const x = await setup("rulesd");
      await x.t.run(
        `update ${x.s}.business_settings set same_day_booking = 1, min_notice_minutes = 120`,
      );
      const base = {
        slug: x.t.slug,
        staffId: x.staff,
        services: [{ serviceId: x.svc, durationMinutes: 30 }],
        totalMinutes: 30,
        locationId: x.loc,
        now: RULES_NOW,
      };
      // Earliest allowed start is 11:00 EDT = 15:00Z.
      const ok = await checkBooking({ ...base, mode: "public", start: new Date("2026-06-17T15:00:00Z") });
      expect(ok.ok).toBe(true);
      // 10:55 EDT is 5 minutes inside the notice window: allowed by the grace.
      const grace = await checkBooking({ ...base, mode: "public", start: new Date("2026-06-17T14:55:00Z") });
      expect(grace.ok).toBe(true);
      // 10:30 EDT is 30 minutes inside: rejected.
      const early = await checkBooking({ ...base, mode: "public", start: new Date("2026-06-17T14:30:00Z") });
      expect(early.ok).toBe(false);
      if (!early.ok) expect(early.reasons).toContain("TOO_SOON");
      const admin = await checkBooking({ ...base, mode: "override", start: new Date("2026-06-17T14:30:00Z") });
      expect(admin.ok).toBe(true);
    },
    120_000,
  );
});

describe("time zone comes from business_settings, not the client", () => {
  itDb(
    "the same hours land at different UTC instants for different tenant zones",
    async () => {
      const { scratchTenant } = await import("./db-fixtures");
      const { listDaySlots } = await import("./service");
      const { loadSchedulingSettings } = await import("./load");

      async function setup(tag: string, tz: string | null) {
        const t = await scratchTenant(tag);
        tenants.push(t);
        const s = `"${t.schema}"`;
        const one = async (q: string) => String((await t.run(q))[0].id);
        const loc = await one(`select id from ${s}.locations order by created_at limit 1`);
        const staff = await one(`insert into ${s}.staff (display_name) values ('S') returning id`);
        const svc = await one(
          `insert into ${s}.services (name, default_duration_minutes) values ('Cut', 60) returning id`,
        );
        await t.run(
          `insert into ${s}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${staff}', 3, '09:00', '12:00', 1, '${loc}')`,
        );
        if (tz) await t.run(`insert into ${s}.business_settings (timezone) values ('${tz}')`);
        return { t, loc, staff, svc };
      }

      const la = await setup("tzla", "America/Los_Angeles");
      const ny = await setup("tzny", null); // no settings row -> default zone

      expect((await loadSchedulingSettings(la.t.slug)).timezone).toBe("America/Los_Angeles");
      expect((await loadSchedulingSettings(ny.t.slug)).timezone).toBe("America/New_York");

      const starts = async (x: Awaited<ReturnType<typeof setup>>) =>
        (
          await listDaySlots({
            slug: x.t.slug,
            staffId: x.staff,
            locationId: x.loc,
            serviceIds: [x.svc],
            clientId: null,
            day: DAY,
            now: NOW,
          })
        ).map((s) => iso(s.start));

      // 09:00 PDT = 16:00Z, 09:00 EDT = 13:00Z; last 60-minute start is 11:00 local.
      expect((await starts(la))[0]).toBe("2026-06-17T16:00:00.000Z");
      expect((await starts(la)).at(-1)).toBe("2026-06-17T18:00:00.000Z");
      expect((await starts(ny))[0]).toBe("2026-06-17T13:00:00.000Z");
      expect((await starts(ny)).at(-1)).toBe("2026-06-17T15:00:00.000Z");
    },
    120_000,
  );
});

describe("split shifts, date overrides and shift locations (migration 0043)", () => {
  async function setup(tag: string) {
    const { scratchTenant } = await import("./db-fixtures");
    const t = await scratchTenant(tag);
    tenants.push(t);
    const s = `"${t.schema}"`;
    const one = async (q: string) => String((await t.run(q))[0].id);
    const l1 = await one(`select id from ${s}.locations order by created_at limit 1`);
    const l2 = await one(`insert into ${s}.locations (name) values ('Second') returning id`);
    const staff = await one(`insert into ${s}.staff (display_name) values ('S') returning id`);
    const svc = await one(
      `insert into ${s}.services (name, default_duration_minutes) values ('Cut', 30) returning id`,
    );
    const hours = (day: number, start: string, end: string, loc: string) =>
      t.run(
        `insert into ${s}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${staff}', ${day}, '${start}', '${end}', 1, '${loc}')`,
      );
    const override = (date: string, intervals: object[]) =>
      t.run(
        `insert into ${s}.availability_overrides (staff_id, date, intervals) values ('${staff}', '${date}', '${JSON.stringify(intervals)}'::jsonb)`,
      );
    return { t, s, l1, l2, staff, svc, hours, override };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  const query = (x: Ctx, extra: object = {}) => ({
    slug: x.t.slug,
    staffId: x.staff,
    locationId: x.l1 as string | null,
    serviceIds: [x.svc],
    clientId: null,
    now: NOW,
    ...extra,
  });
  // Wall-clock labels (EDT) of the slot starts.
  const local = (slots: { start: Date }[]) =>
    slots.map((x) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(x.start),
    );

  itDb(
    "split shifts 09-12 and 14-17 leave no slot between 12:00 and 14:00",
    async () => {
      const { listDaySlots } = await import("./service");
      const x = await setup("splita");
      await x.hours(3, "09:00", "12:00", x.l1);
      await x.hours(3, "14:00", "17:00", x.l1);
      const slots = local(await listDaySlots({ ...query(x), day: DAY }));
      expect(slots).toContain("09:00");
      expect(slots).toContain("11:30");
      expect(slots).toContain("14:00");
      expect(slots).toContain("16:30");
      expect(slots).not.toContain("12:00");
      expect(slots).not.toContain("13:00");
      expect(slots).not.toContain("13:30");
      expect(slots).not.toContain("17:00");
    },
    120_000,
  );

  itDb(
    "a location-scoped query only sees the shifts at that location",
    async () => {
      const { listDaySlots } = await import("./service");
      const x = await setup("splitb");
      await x.hours(3, "09:00", "12:00", x.l1);
      await x.hours(3, "14:00", "17:00", x.l2);
      const atL1 = local(await listDaySlots({ ...query(x), day: DAY }));
      expect(atL1[0]).toBe("09:00");
      expect(atL1.at(-1)).toBe("11:30");
      const atL2 = local(await listDaySlots({ ...query(x, { locationId: x.l2 }), day: DAY }));
      expect(atL2[0]).toBe("14:00");
      expect(atL2.at(-1)).toBe("16:30");
    },
    120_000,
  );

  itDb(
    "a closed override removes that date from listBookableDays and leaves other Wednesdays",
    async () => {
      const { listBookableDays, listDaySlots } = await import("./service");
      const x = await setup("overa");
      await x.hours(3, "09:00", "17:00", x.l1);
      expect(await listBookableDays(query(x))).toContain("2026-06-17");
      await x.override("2026-06-17", []);
      const days = await listBookableDays(query(x));
      expect(days).not.toContain("2026-06-17");
      expect(days).toContain("2026-06-24");
      expect(await listDaySlots({ ...query(x), day: "2026-06-17" })).toEqual([]);
    },
    120_000,
  );

  itDb(
    "an override that opens a normally closed Sunday 10-12 produces Sunday slots",
    async () => {
      const { listBookableDays, listDaySlots } = await import("./service");
      const x = await setup("overb");
      await x.hours(3, "09:00", "17:00", x.l1);
      // 2026-06-21 is a Sunday.
      expect(await listDaySlots({ ...query(x), day: "2026-06-21" })).toEqual([]);
      await x.override("2026-06-21", [{ start: "10:00", end: "12:00", locationId: x.l1 }]);
      const slots = local(await listDaySlots({ ...query(x), day: "2026-06-21" }));
      // 30-minute service on the default 15-minute grid, last start 11:30.
      expect(slots).toEqual(["10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30"]);
      expect(await listBookableDays(query(x))).toContain("2026-06-21");
      // An override at another location is closed from this location's point of view.
      const elsewhere = await listDaySlots({ ...query(x, { locationId: x.l2 }), day: "2026-06-21" });
      expect(elsewhere).toEqual([]);
    },
    120_000,
  );

  itDb(
    "checkBooking follows split shifts and overrides",
    async () => {
      const { checkBooking } = await import("./service");
      const x = await setup("checka");
      await x.hours(3, "09:00", "12:00", x.l1);
      await x.hours(3, "14:00", "17:00", x.l1);
      const base = {
        slug: x.t.slug,
        staffId: x.staff,
        services: [{ serviceId: x.svc, durationMinutes: 30 }],
        totalMinutes: 30,
        locationId: x.l1 as string | null,
        mode: "public" as const,
        now: NOW,
      };
      expect((await checkBooking({ ...base, start: new Date("2026-06-17T14:00:00Z") })).ok).toBe(true); // 10:00
      const gap = await checkBooking({ ...base, start: new Date("2026-06-17T17:00:00Z") }); // 13:00
      expect(gap.ok).toBe(false);
      if (!gap.ok) expect(gap.reasons).toContain("OUTSIDE_HOURS");
      await x.override("2026-06-17", []);
      const closed = await checkBooking({ ...base, start: new Date("2026-06-17T14:00:00Z") });
      expect(closed.ok).toBe(false);
      if (!closed.ok) expect(closed.reasons).toContain("CLOSED_DAY");
    },
    120_000,
  );

  itDb(
    "resolveBookingLocation picks the location of the shift that contains the start time",
    async () => {
      const { resolveBookingLocation } = await import("./service");
      const x = await setup("resolve");
      await x.hours(3, "09:00", "12:00", x.l1);
      await x.hours(3, "14:00", "17:00", x.l2);
      const at = (hhmmUtc: string) => new Date(`2026-06-17T${hhmmUtc}:00Z`);

      // 15:00 EDT is inside the L2 shift, 10:00 EDT inside the L1 shift.
      expect((await resolveBookingLocation(x.t.slug, x.staff, at("19:00"), null))?.id).toBe(x.l2);
      expect((await resolveBookingLocation(x.t.slug, x.staff, at("14:00"), null))?.id).toBe(x.l1);
      // Between the shifts the day's first shift wins.
      expect((await resolveBookingLocation(x.t.slug, x.staff, at("17:00"), null))?.id).toBe(x.l1);
      // A requested location must have a shift that day.
      const requested = await resolveBookingLocation(x.t.slug, x.staff, at("14:00"), x.l2);
      expect(requested).toMatchObject({ id: x.l2, name: "Second" });
      // No hours on Thursday: nothing resolves.
      expect(
        await resolveBookingLocation(x.t.slug, x.staff, new Date("2026-06-18T14:00:00Z"), null),
      ).toBeNull();
      expect(
        await resolveBookingLocation(x.t.slug, x.staff, new Date("2026-06-18T14:00:00Z"), x.l1),
      ).toBeNull();
      // A closed override removes the day.
      await x.override("2026-06-17", []);
      expect(await resolveBookingLocation(x.t.slug, x.staff, at("14:00"), null)).toBeNull();
    },
    120_000,
  );

  itDb(
    "the staff, date overrides table rejects a second override for the same date and a non-array",
    async () => {
      const x = await setup("overc");
      await x.override("2026-06-17", []);
      await expect(x.override("2026-06-17", [])).rejects.toThrow();
      await expect(
        x.t.run(
          `insert into ${x.s}.availability_overrides (staff_id, date, intervals) values ('${x.staff}', '2026-06-18', '{}'::jsonb)`,
        ),
      ).rejects.toThrow();
    },
    120_000,
  );
});

describe("scheduling service: staffId 'any' (Anyone available)", () => {
  let t: ScratchTenant;
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("./db-fixtures");
    t = await scratchTenant("anyavail");
    tenants.push(t);
    const s = `"${t.schema}"`;
    const one = async (q: string) => String((await t.run(q))[0].id);

    ids.l1 = await one(`select id from ${s}.locations order by created_at limit 1`);
    ids.client = await one(`insert into ${s}.clients (name) values ('C') returning id`);
    ids.cut = await one(`insert into ${s}.services (name, default_duration_minutes) values ('Cut', 30) returning id`);
    ids.color = await one(`insert into ${s}.services (name, default_duration_minutes) values ('Color', 30) returning id`);
    // Display-name order: A1 (busy), B2 (free), C3 (free, offers only the cut), D4 (inactive).
    for (const [key, name] of [["s1", "A1"], ["s2", "B2"], ["s3", "C3"], ["s4", "D4"]] as const) {
      ids[key] = await one(
        `insert into ${s}.staff (display_name, is_active) values ('${name}', ${key === "s4" ? 0 : 1}) returning id`,
      );
      await t.run(
        `insert into ${s}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${ids[key]}', 3, '09:00', '17:00', 1, '${ids.l1}')`,
      );
      const offered = key === "s3" ? [ids.cut] : [ids.cut, ids.color];
      for (const svc of offered) {
        await t.run(`insert into ${s}.staff_services (staff_id, service_id) values ('${ids[key]}', '${svc}')`);
      }
    }
    // A1 has two appointments that day: 09:00-09:30 and 09:30-10:00 EDT.
    for (const [a, b] of [["13:00", "13:30"], ["13:30", "14:00"]]) {
      await t.run(
        `insert into ${s}.appointments (staff_id, client_id, location_id, during) values ('${ids.s1}','${ids.client}','${ids.l1}', ${range(`2026-06-17T${a}:00Z`, `2026-06-17T${b}:00Z`)})`,
      );
    }
  }, 120_000);

  itDb(
    "candidates are the active staff who offer every chosen service, in name order",
    async () => {
      const { loadAnyStaffCandidates } = await import("./load");
      expect(await loadAnyStaffCandidates(t.slug, [ids.cut])).toEqual([ids.s1, ids.s2, ids.s3]);
      expect(await loadAnyStaffCandidates(t.slug, [ids.cut, ids.color])).toEqual([ids.s1, ids.s2]);
    },
    60_000,
  );

  itDb(
    "'any' assigns the least-loaded eligible person: S2 (0 appointments), not S1 (2)",
    async () => {
      const { listDaySlots } = await import("./service");
      const slots = await listDaySlots({
        slug: t.slug,
        staffId: "any",
        locationId: ids.l1,
        serviceIds: [ids.cut],
        clientId: null,
        day: DAY,
        now: NOW,
      });
      // 14:00 EDT: S1, S2 and S3 are all free. S2 and S3 both have no appointments; S2 is first by name.
      const at1400 = slots.find((x) => iso(x.start) === "2026-06-17T18:00:00.000Z");
      expect(at1400?.staffId).toBe(ids.s2);
      // One slot per start, never the inactive person.
      const starts = slots.map((x) => iso(x.start));
      expect(new Set(starts).size).toBe(starts.length);
      expect(slots.some((x) => x.staffId === ids.s4)).toBe(false);
      // 09:30 EDT: S1 is busy, so S2 gets it.
      expect(slots.find((x) => iso(x.start) === "2026-06-17T13:30:00.000Z")?.staffId).toBe(ids.s2);
    },
    60_000,
  );

  itDb(
    "only staff who offer all chosen services are candidates (S3 never appears for cut + color)",
    async () => {
      const { listDaySlots, listBookableDays } = await import("./service");
      const slots = await listDaySlots({
        slug: t.slug,
        staffId: "any",
        locationId: ids.l1,
        serviceIds: [ids.cut, ids.color],
        clientId: null,
        day: DAY,
        now: NOW,
      });
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.every((x) => x.staffId === ids.s1 || x.staffId === ids.s2)).toBe(true);
      expect(slots.some((x) => x.staffId === ids.s3)).toBe(false);

      const days = await listBookableDays({
        slug: t.slug,
        staffId: "any",
        locationId: ids.l1,
        serviceIds: [ids.cut],
        clientId: null,
        now: NOW,
      });
      expect(days).toContain(DAY);
    },
    60_000,
  );

  itDb(
    "no one offers the services: no slots",
    async () => {
      const { listDaySlots } = await import("./service");
      const none = await t.run(`insert into "${t.schema}".services (name, default_duration_minutes) values ('Nobody', 30) returning id`);
      const slots = await listDaySlots({
        slug: t.slug,
        staffId: "any",
        locationId: ids.l1,
        serviceIds: [String(none[0].id)],
        clientId: null,
        day: DAY,
        now: NOW,
      });
      expect(slots).toEqual([]);
    },
    60_000,
  );
});
