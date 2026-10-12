// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;

const NOW = new Date("2026-06-10T12:00:00Z");
// Wednesday 17 June 2026 (EDT, UTC-4). Thursday 18 June is a day with no shift.
const WED = new Date("2026-06-17T10:00:00-04:00");
const THU = new Date("2026-06-18T10:00:00-04:00");

describe("pickFallbackLocation", () => {
  const pick = async (p: Parameters<typeof import("@/lib/scheduling/service").pickFallbackLocation>[0]) =>
    (await import("@/lib/scheduling/service")).pickFallbackLocation(p);

  it("prefers the requested active location", async () => {
    expect(await pick({ requested: "b", staffLocationIds: ["a"], activeLocationIds: ["a", "b"] })).toBe("b");
  });
  it("ignores a requested location that is not active", async () => {
    expect(await pick({ requested: "x", staffLocationIds: ["a"], activeLocationIds: ["a", "b"] })).toBe("a");
  });
  it("uses the staff member's only schedule location", async () => {
    expect(await pick({ requested: null, staffLocationIds: ["a", "a"], activeLocationIds: ["a", "b"] })).toBe("a");
  });
  it("skips staff locations that are inactive or ambiguous", async () => {
    expect(await pick({ requested: null, staffLocationIds: ["a", "b"], activeLocationIds: ["a", "b"] })).toBeNull();
    expect(await pick({ requested: null, staffLocationIds: ["gone"], activeLocationIds: ["a"] })).toBe("a");
  });
  it("uses the business's only active location", async () => {
    expect(await pick({ requested: null, staffLocationIds: [], activeLocationIds: ["a"] })).toBe("a");
  });
  it("is null when several locations and nothing narrows it", async () => {
    expect(await pick({ requested: null, staffLocationIds: [], activeLocationIds: ["a", "b"] })).toBeNull();
    expect(await pick({ requested: null, staffLocationIds: [], activeLocationIds: [] })).toBeNull();
  });
});

describe("override bookings without a shift (real tenant schema)", () => {
  let t: ScratchTenant;
  const ids = {} as Record<string, string>;
  const s = () => `"${t.schema}"`;
  const one = async (q: string) => String((await t.run(q))[0].id);

  afterAll(async () => {
    await t?.drop();
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("offshift");
    ids.l1 = await one(`select id from ${s()}.locations order by created_at limit 1`);
    ids.l2 = await one(`insert into ${s()}.locations (name) values ('Second') returning id`);
    await t.run(`update ${s()}.locations set is_active = 0 where id = '${ids.l2}'`);
    ids.client = await one(`insert into ${s()}.clients (name) values ('C') returning id`);
    ids.svc = await one(
      `insert into ${s()}.services (name, default_duration_minutes) values ('Cut', 30) returning id`,
    );
    const staff = async (name: string) => {
      const id = await one(`insert into ${s()}.staff (display_name) values ('${name}') returning id`);
      await t.run(`insert into ${s()}.staff_services (staff_id, service_id) values ('${id}', '${ids.svc}')`);
      return id;
    };
    ids.noShift = await staff("NoShift");
    ids.worker = await staff("Worker");
    // Worker has a Wednesday shift (day 3) at the first location, nothing on Thursday.
    await t.run(
      `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${ids.worker}', 3, '09:00', '17:00', 1, '${ids.l1}')`,
    );
  }, 120_000);

  const book = async (staffId: string, start: Date, mode: "public" | "override", locationId: string | null = null) => {
    const { bookAppointment } = await import("./book");
    return bookAppointment({
      slug: t.slug,
      staffId,
      clientId: ids.client,
      serviceIds: [ids.svc],
      start,
      locationId,
      mode,
      now: NOW,
    });
  };
  const locationOf = async (id: string) => one(`select location_id as id from ${s()}.appointments where id = '${id}'`);

  itDb("single active location: override books it, public is STAFF_UNAVAILABLE", async () => {
    expect(await book(ids.noShift, THU, "public")).toEqual({ ok: false, code: "STAFF_UNAVAILABLE" });
    const r = await book(ids.noShift, THU, "override");
    expect(r.ok).toBe(true);
    if (r.ok) expect(await locationOf(r.id)).toBe(ids.l1);
  }, 60_000);

  itDb("a shift's location still wins for override (regression)", async () => {
    const r = await book(ids.worker, WED, "override");
    expect(r.ok).toBe(true);
    if (r.ok) expect(await locationOf(r.id)).toBe(ids.l1);
  }, 60_000);

  itDb("a staff member's only schedule location is used when the business has several", async () => {
    await t.run(`update ${s()}.locations set is_active = 1 where id = '${ids.l2}'`);
    const r = await book(ids.worker, THU, "override");
    expect(r.ok).toBe(true);
    if (r.ok) expect(await locationOf(r.id)).toBe(ids.l1);
  }, 60_000);

  itDb("two active locations: override fails without a request and books the requested one", async () => {
    await t.run(`update ${s()}.locations set is_active = 1 where id = '${ids.l2}'`);
    expect(await book(ids.noShift, THU, "override")).toEqual({ ok: false, code: "STAFF_UNAVAILABLE" });
    const r = await book(ids.noShift, THU, "override", ids.l2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(await locationOf(r.id)).toBe(ids.l2);
  }, 60_000);
});
