// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

// The booking core and the reschedule action read the tenant from request
// scope and the terms from next-intl; neither exists in a test run.
const tenant = vi.hoisted(() => ({ slug: "" }));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => tenant.slug }));
vi.mock("@/lib/terms/server", async () => {
  const { createTermsT } = await import("@/lib/terms/translator");
  const { VERTICALS } = await import("@/lib/verticals");
  return {
    getT: async (namespace?: string) => createTermsT(VERTICALS.hair_salon.terms, namespace ?? ""),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("@/lib/calendar/sync-tenant", () => ({
  updateBookingOnCalendarForTenant: async () => undefined,
}));
vi.mock("@/lib/services/sync-auto-assistant-tasks", () => ({
  syncAutoAssistantTasksForAppointment: async () => undefined,
}));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => undefined }));
vi.mock("@/lib/notifications/settings", () => ({ getNotificationSettingsForTenant: async () => ({}) }));
vi.mock("@/lib/auth/rbac", () => ({
  getUserRole: async () => "owner",
  requireRole: async () => ({ userId: "u1", role: "owner", tenantSlug: tenant.slug }),
  requireAdminRole: async () => ({ userId: "u1", role: "owner", tenantSlug: tenant.slug }),
  requireStaff: async () => ({ userId: "u1", role: "owner", tenantSlug: tenant.slug }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));

const itDb = process.env.DATABASE_URL ? it : it.skip;

const NOW = new Date("2026-06-10T12:00:00Z");
// Wednesday 17 June 2026 and Wednesday 24 June 2026 (EDT, UTC-4).
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00-04:00`);
const WED1 = "2026-06-17";
const WED2 = "2026-06-24";
const THU = "2026-06-18";

let t: ScratchTenant;
const ids = {
  staff: [] as string[],
  chairs: [] as string[],
  stations: [] as string[],
} as Record<string, string> & { staff: string[]; chairs: string[]; stations: string[] };

afterAll(async () => {
  if (t) await t.drop();
});

const q1 = async (sqlText: string) => String((await t.run(sqlText))[0].id);
const s = () => `"${t.schema}"`;
const range = (d: Date, minutes: number) =>
  `tstzrange('${d.toISOString()}','${new Date(d.getTime() + minutes * 60_000).toISOString()}','[)')`;

async function book(staffIndex: number, serviceId: string, start: Date) {
  const { bookAppointment } = await import("./book");
  return bookAppointment({
    slug: t.slug,
    staffId: ids.staff[staffIndex],
    clientId: ids.client,
    serviceIds: [serviceId],
    start,
    locationId: null,
    mode: "public",
    now: NOW,
  });
}

const heldBy = async (appointmentId: string) =>
  t.run(`select resource_id, is_exclusive from ${s()}.appointment_resources where appointment_id = '${appointmentId}'`);

describe("booking core against a real tenant schema (resources)", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("bookres");
    tenant.slug = t.slug;

    ids.l1 = await q1(`select id from ${s()}.locations order by created_at limit 1`);
    ids.client = await q1(`insert into ${s()}.clients (name) values ('C') returning id`);
    for (let i = 1; i <= 5; i++) {
      const id = await q1(`insert into ${s()}.staff (display_name) values ('S${i}') returning id`);
      ids.staff.push(id);
      // Wednesday (3) and Thursday (4), 09:00-17:00.
      for (const dow of [3, 4]) {
        await t.run(
          `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${id}', ${dow}, '09:00', '17:00', 1, '${ids.l1}')`,
        );
      }
    }
    for (let i = 1; i <= 4; i++) {
      ids.chairs.push(
        await q1(`insert into ${s()}.resources (kind, name) values ('chair', 'Chair ${i}') returning id`),
      );
      ids.stations.push(
        await q1(`insert into ${s()}.resources (kind, name) values ('station', 'Station ${i}') returning id`),
      );
    }
    ids.van = await q1(`insert into ${s()}.resources (kind, name) values ('vehicle', 'Van') returning id`);
    ids.steamer = await q1(
      `insert into ${s()}.resources (kind, name, capacity) values ('equipment', 'Steamer', 2) returning id`,
    );

    const service = (name: string) =>
      q1(`insert into ${s()}.services (name, default_duration_minutes) values ('${name}', 60) returning id`);
    ids.pedicure = await service("Pedicure");
    ids.facial = await service("Facial");
    ids.detail = await service("Detail");
    const need = (serviceId: string, kind: string) =>
      t.run(
        `insert into ${s()}.service_resource_requirements (service_id, resource_kind) values ('${serviceId}', '${kind}')`,
      );
    await need(ids.pedicure, "chair");
    await need(ids.facial, "station");
    await need(ids.detail, "vehicle");
  }, 180_000);

  itDb(
    "the fifth pedicure at 10:00 gets RESOURCE_TAKEN after four take every chair",
    async () => {
      const start = at(WED1, "10:00");
      const booked: string[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await book(i, ids.pedicure, start);
        expect(r).toMatchObject({ ok: true });
        if (r.ok) booked.push(r.id);
      }
      ids.firstPedicure = booked[0];
      const chairs = new Set<string>();
      for (const id of booked) {
        const rows = await heldBy(id);
        expect(rows).toHaveLength(1);
        expect(rows[0].is_exclusive).toBe(1);
        chairs.add(String(rows[0].resource_id));
      }
      expect(chairs.size).toBe(4);
      expect([...chairs].sort()).toEqual([...ids.chairs].sort());

      const fifth = await book(4, ids.pedicure, start);
      expect(fifth).toEqual({ ok: false, code: "RESOURCE_TAKEN" });
    },
    120_000,
  );

  itDb(
    "a raw overlapping insert on a held chair fails with appointment_resources_no_overlap",
    async () => {
      const { pgErrorInfo } = await import("@/lib/db/pg-error");
      const heldChair = String((await heldBy(ids.firstPedicure))[0].resource_id);
      // A bare appointment for the fifth staff member at another time.
      const other = await q1(
        `insert into ${s()}.appointments (staff_id, client_id, location_id, during) values ('${ids.staff[4]}','${ids.client}','${ids.l1}', ${range(at(WED1, "15:00"), 60)}) returning id`,
      );
      let error: unknown;
      try {
        await t.run(
          `insert into ${s()}.appointment_resources (appointment_id, resource_id, during) values ('${other}','${heldChair}', ${range(at(WED1, "10:30"), 60)})`,
        );
      } catch (err) {
        error = err;
      }
      expect(pgErrorInfo(error)).toEqual({
        code: "23P01",
        constraint: "appointment_resources_no_overlap",
      });
    },
    60_000,
  );

  itDb(
    "cancelling a booking frees its resources",
    async () => {
      expect(await heldBy(ids.firstPedicure)).toHaveLength(1);
      await t.run(`update ${s()}.appointments set status = 'cancelled' where id = '${ids.firstPedicure}'`);
      expect(await heldBy(ids.firstPedicure)).toHaveLength(0);

      // The freed chair can be booked again at the same time.
      const again = await book(4, ids.pedicure, at(WED1, "10:00"));
      expect(again).toMatchObject({ ok: true });
    },
    60_000,
  );

  itDb(
    "two bookings racing for the last station: exactly one succeeds",
    async () => {
      const start = at(WED2, "11:00");
      for (let i = 0; i < 3; i++) {
        expect(await book(i, ids.facial, start)).toMatchObject({ ok: true });
      }
      const results = await Promise.all([book(3, ids.facial, start), book(4, ids.facial, start)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const lost = results.find((r) => !r.ok);
      expect(lost).toEqual({ ok: false, code: "RESOURCE_TAKEN" });

      const rows = await t.run(
        `select count(distinct resource_id)::int as n from ${s()}.appointment_resources where resource_id = any(array[${ids.stations.map((x) => `'${x}'::uuid`).join(",")}])`,
      );
      expect(rows[0].n).toBe(4);
    },
    120_000,
  );

  itDb(
    "capacity 2: two overlapping rows are fine, the third fails with appointment_resources_capacity",
    async () => {
      const { pgErrorInfo } = await import("@/lib/db/pg-error");
      const appt = async (staffIndex: number, hhmm: string) =>
        q1(
          `insert into ${s()}.appointments (staff_id, client_id, location_id, during) values ('${ids.staff[staffIndex]}','${ids.client}','${ids.l1}', ${range(at(THU, hhmm), 60)}) returning id`,
        );
      const hold = (appointmentId: string, hhmm: string, exclusive = 1) =>
        t.run(
          `insert into ${s()}.appointment_resources (appointment_id, resource_id, during, is_exclusive) values ('${appointmentId}','${ids.steamer}', ${range(at(THU, hhmm), 60)}, ${exclusive})`,
        );
      const a = await appt(0, "09:00");
      const b = await appt(1, "09:30");
      const c = await appt(2, "09:45");
      await hold(a, "09:00");
      await hold(b, "09:30");
      // The trigger decides is_exclusive from the capacity, not the caller.
      const stored = await t.run(`select is_exclusive from ${s()}.appointment_resources where resource_id = '${ids.steamer}'`);
      expect(stored.map((r) => r.is_exclusive)).toEqual([0, 0]);

      let error: unknown;
      try {
        await hold(c, "09:45");
      } catch (err) {
        error = err;
      }
      expect(pgErrorInfo(error)).toEqual({ code: "23P01", constraint: "appointment_resources_capacity" });

      // After the first ends, a third fits (peak never reaches 2).
      await hold(c, "10:00");
    },
    60_000,
  );

  itDb(
    "rescheduling frees the old chair and holds the new time",
    async () => {
      const { rescheduleBooking } = await import("@/actions/appointments");
      // Staff 3 and 4 are free on Thursday (the steamer test uses staff 0-2).
      const first = await book(3, ids.detail, at(THU, "10:00"));
      expect(first).toMatchObject({ ok: true });
      if (!first.ok) return;

      // The only van is taken at 10:00.
      expect(await book(4, ids.detail, at(THU, "10:00"))).toEqual({ ok: false, code: "RESOURCE_TAKEN" });

      const moved = await rescheduleBooking({
        appointmentId: first.id,
        newStartTime: at(THU, "14:00").toISOString(),
      });
      expect(moved).toMatchObject({ success: true });

      const rows = await t.run(
        `select lower(during) as start from ${s()}.appointment_resources where appointment_id = '${first.id}'`,
      );
      expect(rows).toHaveLength(1);
      expect(new Date(String(rows[0].start)).toISOString()).toBe(at(THU, "14:00").toISOString());

      // The old slot is free again for someone else.
      expect(await book(4, ids.detail, at(THU, "10:00"))).toMatchObject({ ok: true });
    },
    120_000,
  );

  itDb(
    "lineOverrides set the length, the price and the line text, and extra.depositCents is stored",
    async () => {
      const { bookAppointment } = await import("./book");
      const r = await bookAppointment({
        slug: t.slug,
        staffId: ids.staff[2],
        clientId: ids.client,
        serviceIds: [ids.pedicure, ids.facial],
        start: at(WED2, "15:00"),
        locationId: null,
        mode: "public",
        lineOverrides: [
          { serviceId: ids.pedicure, durationMinutes: 45, priceCents: 9000, notes: "Custom pedicure" },
          { serviceId: ids.facial, durationMinutes: 30, priceCents: 2500, notes: "Quick facial" },
        ],
        extra: { depositCents: 3000 },
        now: NOW,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const [appt] = await t.run(
        `select deposit_cents, lower(during) as s, upper(during) as e from ${s()}.appointments where id = '${r.id}'`,
      );
      expect(appt.deposit_cents).toBe(3000);
      expect(new Date(String(appt.e)).getTime() - new Date(String(appt.s)).getTime()).toBe(75 * 60_000);
      const lines = await t.run(
        `select service_id, duration_minutes, price_charged_cents, is_override, notes from ${s()}.appointment_services where appointment_id = '${r.id}' order by duration_minutes desc`,
      );
      expect(lines).toEqual([
        { service_id: ids.pedicure, duration_minutes: 45, price_charged_cents: 9000, is_override: 1, notes: "Custom pedicure" },
        { service_id: ids.facial, duration_minutes: 30, price_charged_cents: 2500, is_override: 1, notes: "Quick facial" },
      ]);
    },
    120_000,
  );
});

describe("group bookings against a real tenant schema", () => {
  let g: ScratchTenant;
  const gids = { staff: [] as string[], chairs: [] as string[] } as Record<string, string> & {
    staff: string[];
    chairs: string[];
  };
  const gs = () => `"${g.schema}"`;
  const one = async (q: string) => String((await g.run(q))[0].id);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    g = await scratchTenant("bookgroup");
    tenant.slug = g.slug;
    gids.l1 = await one(`select id from ${gs()}.locations order by created_at limit 1`);
    gids.client = await one(`insert into ${gs()}.clients (name) values ('Pat') returning id`);
    gids.friend = await one(`insert into ${gs()}.clients (name) values ('Sam') returning id`);
    for (let i = 1; i <= 2; i++) {
      const id = await one(`insert into ${gs()}.staff (display_name) values ('G${i}') returning id`);
      gids.staff.push(id);
      await g.run(
        `insert into ${gs()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${id}', 3, '09:00', '17:00', 1, '${gids.l1}')`,
      );
      gids.chairs.push(await one(`insert into ${gs()}.resources (kind, name) values ('chair', 'Chair ${i}') returning id`));
    }
    gids.mani = await one(`insert into ${gs()}.services (name, default_duration_minutes, price_cents) values ('Mani', 60, 4000) returning id`);
    gids.pedi = await one(`insert into ${gs()}.services (name, default_duration_minutes, price_cents) values ('Pedi', 60, 5000) returning id`);
    for (const svc of [gids.mani, gids.pedi]) {
      await g.run(
        `insert into ${gs()}.service_resource_requirements (service_id, resource_kind) values ('${svc}', 'chair')`,
      );
    }
  }, 180_000);

  afterAll(async () => {
    if (g) await g.drop();
  });

  const groupRows = async () => g.run(`select id, booking_group_id from ${gs()}.appointments where booking_group_id is not null`);

  itDb(
    "a mani + pedi group (same client, 2 staff, 2 chairs) creates 2 rows with the same booking_group_id",
    async () => {
      const { bookGroup } = await import("./book");
      const start = at(WED1, "10:00");
      const r = await bookGroup({
        slug: g.slug,
        payerClientId: gids.client,
        members: [
          { staffId: gids.staff[0], clientId: gids.client, serviceIds: [gids.mani], start, locationId: null },
          { staffId: gids.staff[1], clientId: gids.client, serviceIds: [gids.pedi], start, locationId: null },
        ],
        now: NOW,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.appointmentIds).toHaveLength(2);

      const rows = await groupRows();
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((x) => String(x.booking_group_id)))).toEqual(new Set([r.groupId]));

      // The two members hold different chairs, so they do not collide.
      const held = await g.run(
        `select distinct resource_id from ${gs()}.appointment_resources where appointment_id = any(array[${r.appointmentIds.map((x) => `'${x}'::uuid`).join(",")}])`,
      );
      expect(held).toHaveLength(2);
      const [group] = await g.run(`select kind, client_id from ${gs()}.booking_groups where id = '${r.groupId}'`);
      expect(group).toMatchObject({ kind: "multi_tech", client_id: gids.client });
    },
    120_000,
  );

  itDb(
    "a group where only 1 chair is free writes nothing",
    async () => {
      const { bookGroup } = await import("./book");
      const start = at(WED1, "14:00");
      // Someone else already holds Chair 1 at 14:00.
      const other = await one(
        `insert into ${gs()}.appointments (staff_id, client_id, location_id, during) values ('${gids.staff[0]}','${gids.friend}','${gids.l1}', ${range(start, 60)}) returning id`,
      );
      await g.run(
        `insert into ${gs()}.appointment_resources (appointment_id, resource_id, during) values ('${other}','${gids.chairs[0]}', ${range(start, 60)})`,
      );
      const groupsBefore = (await g.run(`select count(*)::int as n from ${gs()}.booking_groups`))[0].n;
      const apptsBefore = (await g.run(`select count(*)::int as n from ${gs()}.appointments`))[0].n;

      const r = await bookGroup({
        slug: g.slug,
        payerClientId: gids.client,
        members: [
          { staffId: gids.staff[0], clientId: gids.client, serviceIds: [gids.mani], start, locationId: null },
          { staffId: gids.staff[1], clientId: gids.client, serviceIds: [gids.pedi], start, locationId: null },
        ],
        now: NOW,
      });
      expect(r).toEqual({ ok: false, code: "RESOURCE_TAKEN" });
      expect((await g.run(`select count(*)::int as n from ${gs()}.booking_groups`))[0].n).toBe(groupsBefore);
      expect((await g.run(`select count(*)::int as n from ${gs()}.appointments`))[0].n).toBe(apptsBefore);
    },
    120_000,
  );

  itDb(
    "createBookingGroup (admin) books a couple and counts one booking per client",
    async () => {
      const { createBookingGroup } = await import("@/actions/appointments");
      const before = await g.run(`select id, appointments_booked from ${gs()}.clients where id in ('${gids.client}','${gids.friend}')`);
      const count = (rows: Record<string, unknown>[], id: string) => rows.find((x) => x.id === id)?.appointments_booked;
      const r = await createBookingGroup({
        payerClientId: gids.client,
        members: [
          { staffId: gids.staff[0], clientId: gids.client, serviceIds: [gids.mani], startTime: at(WED2, "10:00").toISOString() },
          { staffId: gids.staff[1], clientId: gids.friend, serviceIds: [gids.mani], startTime: at(WED2, "10:00").toISOString() },
        ],
      });
      expect(r).toMatchObject({ success: true });
      const after = await g.run(`select id, appointments_booked from ${gs()}.clients where id in ('${gids.client}','${gids.friend}')`);
      expect(Number(count(after, gids.client))).toBe(Number(count(before, gids.client)) + 1);
      expect(Number(count(after, gids.friend))).toBe(Number(count(before, gids.friend)) + 1);
      if (r.success) {
        const [grp] = await g.run(`select kind from ${gs()}.booking_groups where id = '${r.groupId}'`);
        expect(grp.kind).toBe("couples");
      }
    },
    120_000,
  );
});
