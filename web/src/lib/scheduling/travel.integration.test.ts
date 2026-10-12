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
const utc = (h: string) => `2026-06-17T${h}:00.000Z`;

/**
 * Scenario T: one staff member, one on-site job already booked 09:00-10:00 local at P0.
 * P20 is exactly 20.0 km north of P0, so a trip between them is 20 x 1.4 = 28 km at
 * 40 km/h = 42 minutes, rounded up to 45.
 */
describe("on-site travel against a real tenant schema (Scenario T)", () => {
  let t: ScratchTenant;
  const ids = {} as Record<string, string>;
  const s = () => `"${t.schema}"`;
  const one = async (q: string) => String((await t.run(q))[0].id);

  const slotsFor = async (addressId: string) => {
    const { listDaySlots } = await import("./service");
    return listDaySlots({
      slug: t.slug,
      staffId: ids.staff,
      locationId: ids.loc,
      serviceIds: [ids.clean],
      clientId: null,
      day: DAY,
      serviceAddressId: addressId,
      now: NOW,
    });
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("./db-fixtures");
    const { publicDb } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    t = await scratchTenant("scent");
    tenants.push(t);
    await publicDb.execute(
      sql.raw(
        `update public.tenants set modules = '["on_site"]'::jsonb where slug = '${t.slug}'`,
      ),
    );

    ids.loc = await one(`select id from ${s()}.locations order by created_at limit 1`);
    ids.staff = await one(`insert into ${s()}.staff (display_name) values ('Sam') returning id`);
    ids.client = await one(`insert into ${s()}.clients (name) values ('C') returning id`);
    ids.clean = await one(
      `insert into ${s()}.services (name, default_duration_minutes, location_type) values ('Clean', 60, 'on_site') returning id`,
    );
    await t.run(
      `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${ids.staff}', 3, '09:00', '17:00', 1, '${ids.loc}')`,
    );
    if ((await t.run(`select 1 from ${s()}.business_settings limit 1`)).length === 0) {
      await t.run(`insert into ${s()}.business_settings default values`);
    }
    await t.run(
      `update ${s()}.business_settings set timezone = 'America/New_York', same_day_booking = 1, min_notice_minutes = 0, slot_interval_minutes = 15, arrival_window_min = 120`,
    );
    await t.run(
      `insert into ${s()}.staff_travel_settings (staff_id, base_lat, base_lng, speed_kmh, max_travel_min, travel_buffer_min) values ('${ids.staff}', 40.7128, -74.006, 40, 60, 0)`,
    );
    ids.p0 = await one(
      `insert into ${s()}.client_addresses (client_id, line1, postal_code, lat, lng, geo_source) values ('${ids.client}', '1 Base St', '10007', 40.7128, -74.006, 'manual') returning id`,
    );
    ids.p20 = await one(
      `insert into ${s()}.client_addresses (client_id, line1, postal_code, lat, lng, geo_source) values ('${ids.client}', '20 North Rd', '10470', 40.89266, -74.006, 'manual') returning id`,
    );
    // Job A: 09:00-10:00 local at P0.
    ids.a = await one(
      `insert into ${s()}.appointments (staff_id, client_id, location_id, service_address_id, during) values ('${ids.staff}','${ids.client}','${ids.loc}','${ids.p0}', ${range("2026-06-17T13:00:00Z", "2026-06-17T14:00:00Z")}) returning id`,
    );
  }, 120_000);

  itDb(
    "a job 20 km away leaves 45 minutes of travel after the previous job",
    async () => {
      const slots = await slotsFor(ids.p20);
      const starts = slots.map((x) => iso(x.start));
      for (const blocked of ["14:00", "14:15", "14:30"]) expect(starts).not.toContain(utc(blocked));
      expect(starts[0]).toBe(utc("14:45")); // 10:45 local
      expect(slots[0].travelBeforeMinutes).toBe(45);
    },
    60_000,
  );

  itDb(
    "a job at the same address needs no travel time",
    async () => {
      const slots = await slotsFor(ids.p0);
      expect(iso(slots[0].start)).toBe(utc("14:00")); // 10:00 local
      expect(slots[0].travelBeforeMinutes).toBe(0);
    },
    60_000,
  );

  itDb(
    "the next job also needs travel time before it",
    async () => {
      // Job B: 13:00-14:00 local at P0. A 60 minute job at P20 must end 45 minutes earlier.
      const b = await one(
        `insert into ${s()}.appointments (staff_id, client_id, location_id, service_address_id, during) values ('${ids.staff}','${ids.client}','${ids.loc}','${ids.p0}', ${range("2026-06-17T17:00:00Z", "2026-06-17T18:00:00Z")}) returning id`,
      );
      try {
        const starts = (await slotsFor(ids.p20)).map((x) => iso(x.start));
        expect(starts).toContain(utc("15:15")); // 11:15 local ends 12:15, 45 min before B
        expect(starts).not.toContain(utc("15:30"));
        expect(starts).not.toContain(utc("17:00")); // inside B
        expect(starts).toContain(utc("18:45")); // 14:45 local, after B and the trip
        expect(starts).not.toContain(utc("18:30"));
      } finally {
        await t.run(`delete from ${s()}.appointments where id = '${b}'`);
      }
    },
    60_000,
  );

  itDb(
    "the staff member's extra time between jobs is added to the trip",
    async () => {
      await t.run(`update ${s()}.staff_travel_settings set travel_buffer_min = 10`);
      try {
        const slots = await slotsFor(ids.p20);
        expect(iso(slots[0].start)).toBe(utc("15:00")); // 45 + 10 = 55 min -> 11:00 local
      } finally {
        await t.run(`update ${s()}.staff_travel_settings set travel_buffer_min = 0`);
      }
    },
    60_000,
  );

  itDb(
    "slots carry the arrival window from business settings; 0 means exact time",
    async () => {
      const [first] = await slotsFor(ids.p20);
      expect(iso(first.arrivalWindow!.start)).toBe(iso(first.start));
      expect(first.arrivalWindow!.end.getTime() - first.start.getTime()).toBe(120 * 60_000);

      await t.run(`update ${s()}.business_settings set arrival_window_min = 0`);
      try {
        const [exact] = await slotsFor(ids.p20);
        expect(exact.arrivalWindow).toBeUndefined();
      } finally {
        await t.run(`update ${s()}.business_settings set arrival_window_min = 120`);
      }
    },
    60_000,
  );

  itDb(
    "checkBooking refuses 10:15 at P20 with TRAVEL, reported as TOO_FAR_TO_TRAVEL",
    async () => {
      const { checkBooking } = await import("./service");
      const { failureCodeFor } = await import("./reasons");
      const base = {
        slug: t.slug,
        staffId: ids.staff,
        services: [{ serviceId: ids.clean, durationMinutes: 60 }],
        totalMinutes: 60,
        locationId: ids.loc,
        mode: "public" as const,
        now: NOW,
      };
      const tooSoon = await checkBooking({ ...base, start: new Date(utc("14:15")), serviceAddressId: ids.p20 });
      expect(tooSoon.ok).toBe(false);
      if (!tooSoon.ok) {
        expect(tooSoon.reasons).toContain("TRAVEL");
        expect(failureCodeFor(tooSoon.reasons)).toBe("TOO_FAR_TO_TRAVEL");
      }
      const enough = await checkBooking({ ...base, start: new Date(utc("14:45")), serviceAddressId: ids.p20 });
      expect(enough.ok).toBe(true);
      // The same time is fine for an address that needs no trip.
      const same = await checkBooking({ ...base, start: new Date(utc("14:00")), serviceAddressId: ids.p0 });
      expect(same.ok).toBe(true);
    },
    60_000,
  );

  itDb(
    "a staff member with no travel settings cannot take the job",
    async () => {
      const other = await one(`insert into ${s()}.staff (display_name) values ('No Base') returning id`);
      await t.run(
        `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${other}', 3, '09:00', '17:00', 1, '${ids.loc}')`,
      );
      const { listDaySlots } = await import("./service");
      const slots = await listDaySlots({
        slug: t.slug,
        staffId: other,
        locationId: ids.loc,
        serviceIds: [ids.clean],
        clientId: null,
        day: DAY,
        serviceAddressId: ids.p0,
        now: NOW,
      });
      expect(slots).toEqual([]);
    },
    60_000,
  );
});
