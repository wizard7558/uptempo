// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { ScratchTenant } from "./db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;

const NOW = new Date("2026-06-10T12:00:00Z");
// Window Jun 15 00:00 to Jun 21 00:00 (New York, EDT).
const OPENS = "2026-06-15T04:00:00Z";
const CLOSES = "2026-06-21T04:00:00Z";

let t: ScratchTenant;
const ids = {} as Record<string, string>;

afterAll(async () => {
  await t?.drop();
});

describe("books open and closed per staff member (real tenant schema)", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("./db-fixtures");
    t = await scratchTenant("books");
    const s = `"${t.schema}"`;
    const one = async (q: string) => String((await t.run(q))[0].id);
    ids.loc = await one(`select id from ${s}.locations order by created_at limit 1`);
    ids.svc = await one(
      `insert into ${s}.services (name, default_duration_minutes) values ('Cut', 30) returning id`,
    );
    const add = async (name: string, mode: string) => {
      const id = await one(
        `insert into ${s}.staff (display_name, books_mode) values ('${name}', '${mode}') returning id`,
      );
      await t.run(
        `insert into ${s}.staff_services (staff_id, service_id) values ('${id}', '${ids.svc}')`,
      );
      for (let day = 0; day <= 6; day++) {
        await t.run(
          `insert into ${s}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${id}', ${day}, '09:00', '17:00', 1, '${ids.loc}')`,
        );
      }
      return id;
    };
    ids.open = await add("Open", "open");
    ids.win = await add("Windowed", "windows");
    ids.closed = await add("Closed", "closed");
    ids.reqOnly = await add("RequestsOnly", "windows");
    await t.run(
      `insert into ${s}.booking_windows (staff_id, opens_at, closes_at, mode) values ('${ids.win}', '${OPENS}', '${CLOSES}', 'direct')`,
    );
    await t.run(
      `insert into ${s}.booking_windows (staff_id, opens_at, closes_at, mode) values ('${ids.reqOnly}', '${OPENS}', '${CLOSES}', 'requests')`,
    );
  }, 120_000);

  const days = async (staffId: string) => {
    const { listBookableDays } = await import("./service");
    return listBookableDays({
      slug: t.slug,
      staffId,
      locationId: ids.loc,
      serviceIds: [ids.svc],
      clientId: null,
      now: NOW,
    });
  };

  itDb("an open staff member is bookable on every working day", async () => {
    const d = await days(ids.open);
    expect(d).toContain("2026-06-17");
    expect(d).toContain("2026-06-22");
  }, 60_000);

  itDb("a windows staff member is bookable only inside the direct window", async () => {
    const d = await days(ids.win);
    expect(d).toContain("2026-06-15");
    expect(d).toContain("2026-06-17");
    expect(d).toContain("2026-06-20");
    expect(d).not.toContain("2026-06-14");
    expect(d).not.toContain("2026-06-22");
  }, 60_000);

  itDb("a closed staff member has no bookable days", async () => {
    expect(await days(ids.closed)).toEqual([]);
  }, 60_000);

  itDb("any-staff skips the closed and out-of-window people", async () => {
    const d = await days("any");
    // The open staff member keeps the day listed even though the others are shut.
    expect(d).toContain("2026-06-22");
  }, 60_000);

  itDb("a public check refuses a closed staff member; an admin override does not", async () => {
    const { checkBooking } = await import("./service");
    const base = {
      slug: t.slug,
      staffId: ids.closed,
      start: new Date("2026-06-17T14:00:00Z"),
      services: [{ serviceId: ids.svc, durationMinutes: 30 }],
      totalMinutes: 30,
      locationId: ids.loc,
      now: NOW,
    };
    const pub = await checkBooking({ ...base, mode: "public" });
    expect(pub.ok).toBe(false);
    if (!pub.ok) expect(pub.reasons).toContain("WINDOW_CLOSED");
    expect((await checkBooking({ ...base, mode: "override" })).ok).toBe(true);
    expect((await checkBooking({ ...base, mode: "reschedule" })).ok).toBe(true);
  }, 60_000);

  itDb("a windows staff member with only request windows has no public days, but requests are open inside them", async () => {
    expect(await days(ids.reqOnly)).toEqual([]);
    const { requestsOpen, nextOpening } = await import("@/lib/requests/books");
    expect(await requestsOpen(t.slug, ids.reqOnly, new Date("2026-06-16T12:00:00Z"))).toBe(true);
    expect(await requestsOpen(t.slug, ids.reqOnly, NOW)).toBe(false);
    expect((await nextOpening(t.slug, ids.reqOnly, NOW))?.toISOString()).toBe(
      new Date(OPENS).toISOString(),
    );
    expect(await requestsOpen(t.slug, ids.closed, new Date("2026-06-16T12:00:00Z"))).toBe(false);
    expect(await requestsOpen(t.slug, ids.open, NOW)).toBe(true);
    // Anyone: the open staff member keeps requests open.
    expect(await requestsOpen(t.slug, null, NOW)).toBe(true);
  }, 60_000);
});
