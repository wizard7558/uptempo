// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

// The public actions run outside a request: stub the request-only pieces.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.77" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/tenant/modules", () => ({ hasModule: async () => true }));
vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string) => `${ns}.${key}`,
}));

const itDb = process.env.DATABASE_URL ? it : it.skip;

// America/New_York. 2026-06-17 is a Wednesday and EDT is UTC-4, so 10:00 local.
const NOW = new Date("2026-06-17T14:00:00Z");
const range = (a: string, b: string) => `tstzrange('${a}','${b}','[)')`;

const tenants: ScratchTenant[] = [];
afterAll(async () => {
  for (const t of tenants) await t.drop();
});

describe("loadQueueBoard against a real tenant schema", () => {
  let t: ScratchTenant;
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("qboard");
    tenants.push(t);
    const s = `"${t.schema}"`;
    const one = async (q: string) => String((await t.run(q))[0].id);

    await t.run(`insert into ${s}.business_settings (timezone, queue_open) values ('America/New_York', 1)`);
    ids.l1 = await one(`select id from ${s}.locations order by created_at limit 1`);
    ids.a = await one(`insert into ${s}.staff (display_name, role) values ('Alex', 'provider') returning id`);
    ids.b = await one(`insert into ${s}.staff (display_name, role) values ('Blair', 'provider') returning id`);
    ids.client = await one(`insert into ${s}.clients (name) values ('Past Client') returning id`);
    ids.cut = await one(
      `insert into ${s}.services (name, default_duration_minutes) values ('Cut', 30) returning id`,
    );
    ids.color = await one(
      `insert into ${s}.services (name, default_duration_minutes) values ('Color', 60) returning id`,
    );
    for (const [staff, svc] of [
      [ids.a, ids.cut],
      [ids.b, ids.cut],
      [ids.a, ids.color],
    ]) {
      await t.run(`insert into ${s}.staff_services (staff_id, service_id) values ('${staff}','${svc}')`);
    }
    for (const staff of [ids.a, ids.b]) {
      await t.run(
        `insert into ${s}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${staff}', 3, '09:00', '17:00', 1, '${ids.l1}')`,
      );
    }
    // Alex is booked 10:00-10:45 local.
    await t.run(
      `insert into ${s}.appointments (staff_id, client_id, location_id, during, status) values ('${ids.a}','${ids.client}','${ids.l1}', ${range("2026-06-17T14:00:00Z", "2026-06-17T14:45:00Z")}, 'confirmed')`,
    );
    // Three finished Cut walk-ins that took 20, 25 and 30 minutes (mean 25).
    for (const [i, m] of [20, 25, 30].entries()) {
      await t.run(
        `insert into ${s}.queue_entries (name, service_id, status, public_token_hash, started_at, done_at)
         values ('Done ${i}', '${ids.cut}', 'done', 'done-${i}', '2026-06-16T15:00:00Z', timestamp with time zone '2026-06-16T15:00:00Z' + interval '${m} minutes')`,
      );
    }
    // The line, in join order.
    const waiting = (name: string, svc: string, pref: string | null, joined: string) =>
      t.run(
        `insert into ${s}.queue_entries (location_id, name, service_id, preferred_staff_id, status, public_token_hash, joined_at)
         values ('${ids.l1}', '${name}', '${svc}', ${pref ? `'${pref}'` : "null"}, 'waiting', '${name}-tok', '${joined}')`,
      );
    await waiting("e1", ids.cut, null, "2026-06-17T13:50:00Z");
    await waiting("e2", ids.color, null, "2026-06-17T13:51:00Z");
    await waiting("e3", ids.cut, ids.b, "2026-06-17T13:52:00Z");
  }, 120_000);

  itDb(
    "numbers the line and estimates each wait from real availability",
    async () => {
      const { loadQueueBoard } = await import("./board");
      const board = await loadQueueBoard(t.slug, ids.l1, NOW);

      expect(board.open).toBe(true);
      expect(board.timezone).toBe("America/New_York");
      expect(board.waiting.map((w) => w.name)).toEqual(["e1", "e2", "e3"]);
      expect(board.waiting.map((w) => w.position)).toEqual([1, 2, 3]);
      expect(board.waiting.map((w) => w.waitMinutes)).toEqual([0, 45, 25]);
      // A new 30-minute any-staff job lands after everyone: Blair is free 10:50, Alex 11:45.
      expect(board.waitNowMinutes).toBe(50);
      expect(board.called).toEqual([]);
      expect(board.inService).toEqual([]);

      const free = Object.fromEntries(board.staff.map((p) => [p.name, p.freeAt?.toISOString()]));
      expect(free).toEqual({
        Alex: "2026-06-17T14:45:00.000Z", // 10:45 local
        Blair: "2026-06-17T14:00:00.000Z", // 10:00 local
      });
    },
    60_000,
  );

  itDb(
    "serves a cached copy only when asked to",
    async () => {
      const { loadQueueBoard } = await import("./board");
      const first = await loadQueueBoard(t.slug, ids.l1, NOW, { cached: true });
      const second = await loadQueueBoard(t.slug, ids.l1, NOW, { cached: true });
      expect(second).toBe(first);
      const fresh = await loadQueueBoard(t.slug, ids.l1, NOW);
      expect(fresh).not.toBe(first);
      expect(fresh.waiting.map((w) => w.waitMinutes)).toEqual([0, 45, 25]);
    },
    60_000,
  );
});

describe("public join, status route and leave against a real tenant schema", () => {
  let t: ScratchTenant;
  let l1: string;
  const TOKEN_BAD = "z".repeat(32);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("qpublic");
    tenants.push(t);
    const s = `"${t.schema}"`;
    await t.run(
      `insert into ${s}.business_settings (timezone, queue_open, queue_max_waiting) values ('America/New_York', 1, 30)`,
    );
    l1 = String((await t.run(`select id from ${s}.locations order by created_at limit 1`))[0].id);
    await t.run(`insert into ${s}.staff (display_name, role) values ('Alex', 'provider')`);
  }, 120_000);

  const entryUrl = (token: string) => new Request(`http://localhost/api/q/${t.slug}/entry?t=${token}`);
  const ctx = () => ({ params: Promise.resolve({ slug: t.slug }) });
  const person = (phone: string) => ({
    slug: t.slug,
    locationId: l1,
    name: "Maria Lopez",
    phone,
    serviceId: null,
    preferredStaffId: null,
    smsConsent: false,
  });

  itDb(
    "joins once, refuses the same phone twice, serves the status, and leaves",
    async () => {
      const { joinQueue, leaveQueue, getQueueJoinInfo } = await import("@/actions/queue-public");
      const { GET } = await import("@/app/api/q/[slug]/entry/route");

      const first = await joinQueue(person("555-010-0001"));
      expect(first.success).toBe(true);
      if (!first.success) return;
      expect(first.position).toBe(1);

      const again = await joinQueue(person("(555) 010-0001"));
      expect(again).toEqual({ success: false, error: "errors.queue.alreadyInLine" });

      // The stored row has the hash, never the token.
      const s = `"${t.schema}"`;
      const rows = await t.run(`select public_token_hash, status, source from ${s}.queue_entries`);
      expect(rows).toHaveLength(1);
      expect(rows[0].public_token_hash).not.toBe(first.token);
      expect(rows[0]).toMatchObject({ status: "waiting", source: "qr" });

      const res = await GET(entryUrl(first.token), ctx());
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = await res.json();
      expect(body).toMatchObject({ status: "waiting", position: 1 });
      expect(JSON.stringify(body)).not.toContain(String(rows[0].public_token_hash));

      const info = await getQueueJoinInfo(t.slug, l1);
      expect(info.success && info.waitingCount).toBe(1);
      expect(info.success && info.waitingNames).toEqual([]);

      await leaveQueue(t.slug, first.token);
      const after = await t.run(`select status, left_at from ${s}.queue_entries`);
      expect(after[0].status).toBe("left");
      expect(after[0].left_at).not.toBeNull();
      const gone = await (await GET(entryUrl(first.token), ctx())).json();
      expect(gone.status).toBe("left");
    },
    120_000,
  );

  itDb(
    "answers 404 with an empty body for a bad, unknown, or missing token",
    async () => {
      const { GET } = await import("@/app/api/q/[slug]/entry/route");
      for (const url of [entryUrl("short"), entryUrl(TOKEN_BAD), new Request(`http://localhost/api/q/${t.slug}/entry`)]) {
        const res = await GET(url, ctx());
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({});
      }
      const badSlug = await GET(entryUrl(TOKEN_BAD), { params: Promise.resolve({ slug: "../x" }) });
      expect(badSlug.status).toBe(404);
    },
    60_000,
  );
});

describe("calling, starting and finishing against a real tenant schema", () => {
  let t: ScratchTenant;
  const ids = {} as Record<string, string>;
  const s = () => `"${t.schema}"`;
  const one = async (q: string) => String((await t.run(q))[0].id);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("qline");
    tenants.push(t);
    await t.run(`insert into ${s()}.business_settings (timezone, queue_open) values ('America/New_York', 1)`);
    ids.l1 = await one(`select id from ${s()}.locations order by created_at limit 1`);
    ids.a = await one(`insert into ${s()}.staff (display_name, role) values ('Alex', 'provider') returning id`);
    ids.b = await one(`insert into ${s()}.staff (display_name, role) values ('Blair', 'provider') returning id`);
    ids.client = await one(`insert into ${s()}.clients (name) values ('Walk In') returning id`);
    ids.cut = await one(
      `insert into ${s()}.services (name, default_duration_minutes) values ('Cut', 30) returning id`,
    );
    for (const staff of [ids.a, ids.b]) {
      await t.run(`insert into ${s()}.staff_services (staff_id, service_id) values ('${staff}','${ids.cut}')`);
      await t.run(
        `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${staff}', 3, '09:00', '17:00', 1, '${ids.l1}')`,
      );
    }
    const waiting = async (name: string, pref: string | null, joined: string) =>
      one(
        `insert into ${s()}.queue_entries (location_id, client_id, name, service_id, preferred_staff_id, status, public_token_hash, joined_at)
         values ('${ids.l1}', '${ids.client}', '${name}', '${ids.cut}', ${pref ? `'${pref}'` : "null"}, 'waiting', '${name}-tok', '${joined}') returning id`,
      );
    ids.e1 = await waiting("e1", null, "2026-06-17T13:50:00Z");
    ids.e3 = await waiting("e3", ids.b, "2026-06-17T13:52:00Z");
  }, 120_000);

  itDb(
    "calls the first person Blair can take, books them from this minute, and trims the visit when finished",
    async () => {
      const { claimEntry, beginService, endService } = await import("./line");

      // e1 joined first and takes anyone, so Blair gets e1 even though e3 asked for Blair.
      const claim = await claimEntry(t.slug, { staffId: ids.b, locationId: ids.l1, entryId: null }, NOW);
      expect(claim.status).toBe("ok");
      if (claim.status !== "ok") return;
      expect(claim.entry.id).toBe(ids.e1);
      const called = (await t.run(`select status, assigned_staff_id, called_at from ${s()}.queue_entries where id = '${ids.e1}'`))[0];
      expect(called).toMatchObject({ status: "called", assigned_staff_id: ids.b });
      expect(new Date(called.called_at as string).toISOString()).toBe(NOW.toISOString());

      // Start at 10:00:42; the appointment begins at the floor of the minute.
      const started = await beginService(t.slug, { entryId: ids.e1, serviceId: null }, new Date("2026-06-17T14:00:42Z"));
      expect(started.status).toBe("ok");
      if (started.status !== "ok") return;
      const appt = (
        await t.run(
          `select staff_id, lower(during) as s, upper(during) as e from ${s()}.appointments where id = '${started.appointmentId}'`,
        )
      )[0];
      expect(appt.staff_id).toBe(ids.b);
      expect(new Date(appt.s as string).toISOString()).toBe("2026-06-17T14:00:00.000Z");
      expect(new Date(appt.e as string).toISOString()).toBe("2026-06-17T14:30:00.000Z");
      const inService = (await t.run(`select status, appointment_id from ${s()}.queue_entries where id = '${ids.e1}'`))[0];
      expect(inService).toMatchObject({ status: "in_service", appointment_id: started.appointmentId });

      // A second start on the same entry does nothing.
      expect((await beginService(t.slug, { entryId: ids.e1, serviceId: null }, NOW)).status).toBe("stale");

      // Done 10 minutes later: the visit ends then, not at 10:30.
      const later = new Date("2026-06-17T14:10:00Z");
      const done = await endService(t.slug, ids.e1, later);
      expect(done).toEqual({ appointmentId: started.appointmentId });
      const trimmed = (await t.run(`select upper(during) as e from ${s()}.appointments where id = '${started.appointmentId}'`))[0];
      expect(new Date(trimmed.e as string).toISOString()).toBe(later.toISOString());
      const row = (await t.run(`select status, done_at from ${s()}.queue_entries where id = '${ids.e1}'`))[0];
      expect(row.status).toBe("done");
      expect(await endService(t.slug, ids.e1, later)).toBeNull();
    },
    120_000,
  );

  itDb(
    "two calls at once for different staff claim different people",
    async () => {
      const { claimEntry } = await import("./line");
      await t.run(`update ${s()}.queue_entries set status = 'left' where id = '${ids.e3}'`);
      for (const [name, joined] of [
        ["e4", "2026-06-17T13:55:00Z"],
        ["e5", "2026-06-17T13:56:00Z"],
      ]) {
        await t.run(
          `insert into ${s()}.queue_entries (location_id, name, service_id, status, public_token_hash, joined_at)
           values ('${ids.l1}', '${name}', '${ids.cut}', 'waiting', '${name}-tok', '${joined}')`,
        );
      }
      const [x, y] = await Promise.all([
        claimEntry(t.slug, { staffId: ids.a, locationId: ids.l1, entryId: null }, NOW),
        claimEntry(t.slug, { staffId: ids.b, locationId: ids.l1, entryId: null }, NOW),
      ]);
      expect(x.status).toBe("ok");
      expect(y.status).toBe("ok");
      if (x.status !== "ok" || y.status !== "ok") return;
      expect(new Set([x.entry.id, y.entry.id]).size).toBe(2);
      const called = await t.run(`select name from ${s()}.queue_entries where status = 'called' order by name`);
      expect(called.map((r) => r.name)).toEqual(["e4", "e5"]);

      // The line is empty now.
      const none = await claimEntry(t.slug, { staffId: ids.a, locationId: ids.l1, entryId: null }, NOW);
      expect(none.status).toBe("empty");
    },
    120_000,
  );
});
