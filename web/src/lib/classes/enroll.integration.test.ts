// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";

const itDb = process.env.DATABASE_URL ? it : it.skip;
vi.setConfig({ testTimeout: 180_000 });

const mocks = vi.hoisted(() => ({
  sendSms: vi.fn(),
  sendEmail: vi.fn(),
  consentOn: false,
}));

vi.mock("@/lib/sms/send", () => ({ sendSms: mocks.sendSms }));
vi.mock("@/lib/email/send", () => ({ sendEmail: mocks.sendEmail }));
// The scratch tenant is not in the registry; only the age gate asks whether a module is on.
vi.mock("@/lib/tenant/modules", () => ({
  hasModule: async (_slug: string, id: string) => (id === "consent_id" ? mocks.consentOn : false),
  assertModule: async () => undefined,
  ModuleDisabledError: class extends Error {},
}));

type Enroll = typeof import("./enroll");

let t: ScratchTenant;
let lib: Enroll;
const ids = {} as Record<string, string>;
const S = () => `"${t.schema}"`;
const one = async (q: string) => String((await t.run(q))[0].id);
const HOUR = 3_600_000;
let phoneSeq = 0;

afterAll(async () => {
  if (t) await t.drop();
});

beforeEach(() => {
  mocks.sendSms.mockReset();
  mocks.sendSms.mockResolvedValue({ success: true, messageSid: "SM1" });
  mocks.sendEmail.mockReset();
  mocks.sendEmail.mockResolvedValue({ success: true });
  mocks.consentOn = false;
});

const range = (start: Date, minutes = 45) =>
  `tstzrange('${start.toISOString()}','${new Date(start.getTime() + minutes * 60_000).toISOString()}','[)')`;
const inHours = (h: number) => new Date(Date.now() + h * HOUR);

async function mkSession(capacity: number, waitlist: number, startsInHours = 72) {
  return one(
    `insert into ${S()}.class_sessions (service_id, staff_id, during, capacity, waitlist_capacity)
     values ('${ids.svc}', '${ids.staff}', ${range(inHours(startsInHours))}, ${capacity}, ${waitlist}) returning id`,
  );
}

async function mkClient(name: string, opts: { phone?: boolean; credits?: number; birthday?: string } = {}) {
  const phone = opts.phone === false ? "NULL" : `'+1555${String(1_000_000 + ++phoneSeq)}'`;
  const id = await one(
    `insert into ${S()}.clients (name, phone${opts.birthday ? ", birthday" : ""})
     values ('${name}', ${phone}${opts.birthday ? `, '${opts.birthday}'` : ""}) returning id`,
  );
  let pkg = "";
  if (opts.credits) {
    pkg = await one(`insert into ${S()}.client_packages (client_id, name) values ('${id}', 'Ten pack') returning id`);
    await t.run(
      `insert into ${S()}.credit_ledger (client_package_id, reason, delta, reference_id) values ('${pkg}', 'purchase', ${opts.credits}, 'seed:${pkg}')`,
    );
  }
  const phoneValue = String((await t.run(`select phone from ${S()}.clients where id = '${id}'`))[0].phone ?? "");
  return { id, pkg, phone: phoneValue };
}

const balance = async (pkg: string) =>
  Number((await t.run(`select credits_remaining from ${S()}.client_packages where id = '${pkg}'`))[0].credits_remaining);

const enrollment = async (sessionId: string, clientId: string) =>
  (await t.run(
    `select id, status, waitlist_position, promoted_at, credit_entry_id from ${S()}.class_enrollments
      where session_id = '${sessionId}' and client_id = '${clientId}' order by created_at desc limit 1`,
  ))[0];

const enroll = (sessionId: string, clientId: string, useCredit = false, actor: "client" | "staff" = "client") =>
  lib.enrollInClass(t.slug, { sessionId, clientId, useCredit, actor });

describe("class enrollment engine against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("klass");
    lib = await import("./enroll");
    ids.staff = await one(`insert into ${S()}.staff (display_name) values ('Jordan Trainer') returning id`);
    ids.svc = await one(
      `insert into ${S()}.services (name, default_duration_minutes, price_cents, is_class, class_capacity)
       values ('Bootcamp', 45, 2000, 1, 12) returning id`,
    );
    await t.run(`insert into ${S()}.business_settings (timezone) select 'UTC' where not exists (select 1 from ${S()}.business_settings)`);
    await t.run(`update ${S()}.business_settings set timezone = 'UTC', cancellation_window_hours = 24`);
  }, 180_000);

  itDb("1-2. a full class waitlists in order, and a cancel promotes the first and texts once", async () => {
    const s = await mkSession(2, 3);
    const [a, b, c, d] = await Promise.all(["A", "B", "C", "D"].map((n) => mkClient(`Wait ${n}`)));
    // Sequential on purpose: the order people joined is the order of the line.
    expect(await enroll(s, a.id)).toMatchObject({ status: "booked" });
    expect(await enroll(s, b.id)).toMatchObject({ status: "booked" });
    expect(await enroll(s, c.id)).toEqual({ status: "waitlisted", position: 1 });
    expect(await enroll(s, d.id)).toEqual({ status: "waitlisted", position: 2 });
    expect(mocks.sendSms).not.toHaveBeenCalled();

    const res = await lib.cancelEnrollment(t.slug, {
      enrollmentId: String((await enrollment(s, b.id)).id),
      actor: "client",
    });
    expect(res).toEqual({ promotedClientId: c.id });
    expect(await enrollment(s, b.id)).toMatchObject({ status: "cancelled" });
    const cRow = await enrollment(s, c.id);
    expect(cRow).toMatchObject({ status: "booked", waitlist_position: null });
    expect(cRow.promoted_at).not.toBeNull();
    expect(await enrollment(s, d.id)).toMatchObject({ status: "waitlisted", waitlist_position: 1 });

    expect(mocks.sendSms).toHaveBeenCalledTimes(1);
    const arg = mocks.sendSms.mock.calls[0][0];
    expect(arg).toMatchObject({ to: c.phone, tenantSlug: t.slug, clientId: c.id, messageType: "waitlist_promoted" });
    expect(arg.body).toContain("a spot opened");
    expect(arg.body).toMatch(/^[\x20-\x7E]+$/);
    expect(arg.body).not.toContain("{");
  });

  itDb("a text that fails or throws never breaks the cancel", async () => {
    const s = await mkSession(1, 2);
    const a = await mkClient("Fail A");
    const b = await mkClient("Fail B");
    await enroll(s, a.id);
    await enroll(s, b.id);
    mocks.sendSms.mockRejectedValueOnce(new Error("twilio down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await lib.cancelEnrollment(t.slug, { enrollmentId: String((await enrollment(s, a.id)).id), actor: "staff" });
    spy.mockRestore();
    expect(res).toEqual({ promotedClientId: b.id });
    expect(await enrollment(s, b.id)).toMatchObject({ status: "booked" });
    expect(mocks.sendSms).toHaveBeenCalledTimes(1);
  });

  itDb("3. a late cancel burns the credit and an on-time cancel gives it back (9, 9, 8, 9)", async () => {
    const a = await mkClient("Credit A", { credits: 10 });
    const soon = await mkSession(5, 0, 2);
    const later = await mkSession(5, 0, 72);

    const first = await enroll(soon, a.id, true);
    expect(first).toMatchObject({ status: "booked" });
    expect("creditEntryId" in first && first.creditEntryId).toBeTruthy();
    expect(await balance(a.pkg)).toBe(9);

    await lib.cancelEnrollment(t.slug, { enrollmentId: String((await enrollment(soon, a.id)).id), actor: "client" });
    expect(await enrollment(soon, a.id)).toMatchObject({ status: "late_cancel" });
    expect(await balance(a.pkg)).toBe(9);

    await enroll(later, a.id, true);
    expect(await balance(a.pkg)).toBe(8);
    await lib.cancelEnrollment(t.slug, { enrollmentId: String((await enrollment(later, a.id)).id), actor: "client" });
    expect(await enrollment(later, a.id)).toMatchObject({ status: "cancelled" });
    expect(await balance(a.pkg)).toBe(9);
  });

  itDb("staff choose whether a cancelled spot gets its credit back", async () => {
    const a = await mkClient("Staff Keep", { credits: 3 });
    const b = await mkClient("Staff Give", { credits: 3 });
    const s = await mkSession(5, 0, 72);
    await enroll(s, a.id, true, "staff");
    await enroll(s, b.id, true, "staff");
    await lib.cancelEnrollment(t.slug, { enrollmentId: String((await enrollment(s, a.id)).id), actor: "staff", refundCredit: false });
    await lib.cancelEnrollment(t.slug, { enrollmentId: String((await enrollment(s, b.id)).id), actor: "staff" });
    expect(await enrollment(s, a.id)).toMatchObject({ status: "late_cancel" });
    expect(await enrollment(s, b.id)).toMatchObject({ status: "cancelled" });
    expect(await balance(a.pkg)).toBe(2);
    expect(await balance(b.pkg)).toBe(3);
  });

  itDb("a waitlisted spot takes no credit, and the promotion spends one when the client has a pack", async () => {
    const s = await mkSession(1, 3);
    const a = await mkClient("Promo A");
    const b = await mkClient("Promo B", { credits: 5 });
    await enroll(s, a.id);
    const waiting = await enroll(s, b.id, true);
    expect(waiting).toEqual({ status: "waitlisted", position: 1 });
    expect(await balance(b.pkg)).toBe(5);
    await lib.cancelEnrollment(t.slug, { enrollmentId: String((await enrollment(s, a.id)).id), actor: "staff" });
    expect(await enrollment(s, b.id)).toMatchObject({ status: "booked" });
    expect((await enrollment(s, b.id)).credit_entry_id).not.toBeNull();
    expect(await balance(b.pkg)).toBe(4);
  });

  itDb("5. five at once for one seat: one booked, four waitlisted with positions 1 to 4", async () => {
    const s = await mkSession(1, 10);
    const clients = await Promise.all([1, 2, 3, 4, 5].map((n) => mkClient(`Race ${n}`)));
    const results = await Promise.all(clients.map((c) => enroll(s, c.id)));
    expect(results.filter((r) => "status" in r && r.status === "booked")).toHaveLength(1);
    const waiting = results.filter((r) => "status" in r && r.status === "waitlisted");
    expect(waiting).toHaveLength(4);
    expect(results.some((r) => "error" in r)).toBe(false);
    const positions = waiting.map((r) => ("position" in r ? r.position : undefined)).sort();
    expect(positions).toEqual([1, 2, 3, 4]);
    const rows = await t.run(
      `select status, count(*)::int as n, count(distinct waitlist_position)::int as p from ${S()}.class_enrollments where session_id = '${s}' group by status`,
    );
    expect(rows.find((r) => r.status === "booked")?.n).toBe(1);
    expect(rows.find((r) => r.status === "waitlisted")).toMatchObject({ n: 4, p: 4 });
  });

  itDb("a full waitlist says FULL", async () => {
    const s = await mkSession(1, 1);
    const [a, b, c] = await Promise.all(["F1", "F2", "F3"].map((n) => mkClient(n)));
    await enroll(s, a.id);
    await enroll(s, b.id);
    expect(await enroll(s, c.id)).toEqual({ error: "FULL" });
    expect(await enrollment(s, c.id)).toBeUndefined();
  });

  itDb("enrolling after the start says STARTED, and enrolling twice says ALREADY", async () => {
    const started = await mkSession(5, 0, -1);
    const a = await mkClient("Late Larry");
    expect(await enroll(started, a.id)).toEqual({ error: "STARTED" });
    expect(await enrollment(started, a.id)).toBeUndefined();

    const s = await mkSession(5, 0);
    expect(await enroll(s, a.id)).toMatchObject({ status: "booked" });
    expect(await enroll(s, a.id)).toEqual({ error: "ALREADY" });
    const n = await t.run(`select count(*)::int as n from ${S()}.class_enrollments where session_id = '${s}'`);
    expect(n[0].n).toBe(1);
  });

  itDb("an age-limited class refuses an underage birthday and writes no row", async () => {
    const tpl = await one(
      `insert into ${S()}.form_templates (name, kind, min_age, is_active) values ('Over 18', 'consent', 18, 1) returning id`,
    );
    const svc = await one(
      `insert into ${S()}.services (name, default_duration_minutes, is_class, class_capacity) values ('Adults only', 45, 1, 10) returning id`,
    );
    await t.run(`insert into ${S()}.service_form_assignments (service_id, form_template_id) values ('${svc}', '${tpl}')`);
    const s = await one(
      `insert into ${S()}.class_sessions (service_id, staff_id, during, capacity) values ('${svc}', '${ids.staff}', ${range(inHours(72))}, 5) returning id`,
    );
    mocks.consentOn = true;
    const kid = await mkClient("Kid", { birthday: "2015-03-01" });
    const adult = await mkClient("Adult", { birthday: "1990-03-01" });
    const unknown = await mkClient("No Birthday");
    expect(await enroll(s, kid.id)).toEqual({ error: "UNDERAGE" });
    expect(await enrollment(s, kid.id)).toBeUndefined();
    expect(await enroll(s, unknown.id)).toEqual({ error: "DOB_REQUIRED" });
    expect(await enrollment(s, unknown.id)).toBeUndefined();
    expect(await enroll(s, adult.id)).toMatchObject({ status: "booked" });
    // Staff are let through when no birthday is on file.
    expect(await enroll(s, unknown.id, false, "staff")).toMatchObject({ status: "booked" });
  });

  itDb("setSessionCapacity refuses a number below the booked count and promotes in order when raised", async () => {
    const s = await mkSession(2, 5);
    const [a, b, c, d, e] = await Promise.all(["K1", "K2", "K3", "K4", "K5"].map((n) => mkClient(n)));
    for (const cl of [a, b, c, d, e]) await enroll(s, cl.id);
    expect(await enrollment(s, e.id)).toMatchObject({ status: "waitlisted", waitlist_position: 3 });

    const below = await lib.setSessionCapacity(t.slug, s, 1);
    expect(below).toEqual({ success: false, error: "More people are booked than that. Cancel some spots first." });
    expect(Number((await t.run(`select capacity from ${S()}.class_sessions where id = '${s}'`))[0].capacity)).toBe(2);

    expect(await lib.setSessionCapacity(t.slug, s, 4)).toEqual({ success: true, promoted: 2 });
    expect(await enrollment(s, c.id)).toMatchObject({ status: "booked" });
    expect(await enrollment(s, d.id)).toMatchObject({ status: "booked" });
    expect(await enrollment(s, e.id)).toMatchObject({ status: "waitlisted", waitlist_position: 1 });
    expect(mocks.sendSms.mock.calls.map((x) => x[0].clientId)).toEqual([c.id, d.id]);
  });

  itDb("6. cancelSession refunds every credit, cancels everyone, removes the time block and texts those booked", async () => {
    const made = await lib.createClassSessions(t.slug, {
      serviceId: ids.svc,
      staffId: ids.staff,
      locationId: null,
      resourceId: null,
      date: new Date(Date.now() + 3 * 24 * HOUR).toISOString().slice(0, 10),
      startTime: "09:00",
      capacity: 2,
      waitlistCapacity: 3,
      priceCents: null,
      repeatWeeks: 0,
      allowConflicts: false,
    });
    expect("sessionIds" in made).toBe(true);
    const s = "sessionIds" in made ? made.sessionIds[0] : "";
    const [blockRow] = await t.run(`select time_block_id from ${S()}.class_sessions where id = '${s}'`);
    const blockId = String(blockRow.time_block_id);
    expect(blockId).not.toBe("null");

    const a = await mkClient("Cancel A", { credits: 10 });
    const b = await mkClient("Cancel B", { credits: 10 });
    const c = await mkClient("Cancel C", { credits: 10 });
    await enroll(s, a.id, true);
    await enroll(s, b.id, true);
    await enroll(s, c.id, true);
    expect(await enrollment(s, c.id)).toMatchObject({ status: "waitlisted" });
    expect([await balance(a.pkg), await balance(b.pkg), await balance(c.pkg)]).toEqual([9, 9, 10]);

    // Even a class about to start gives every credit back: the class is not happening.
    await t.run(`update ${S()}.class_sessions set during = ${range(inHours(1))} where id = '${s}'`);
    mocks.sendSms.mockClear();
    const res = await lib.cancelSession(t.slug, s);
    expect(res).toEqual({ success: true, notified: 2 });

    expect([await balance(a.pkg), await balance(b.pkg), await balance(c.pkg)]).toEqual([10, 10, 10]);
    const statuses = await t.run(`select distinct status from ${S()}.class_enrollments where session_id = '${s}'`);
    expect(statuses).toEqual([{ status: "cancelled" }]);
    expect(Number((await t.run(`select count(*)::int as n from ${S()}.time_blocks where id = '${blockId}'`))[0].n)).toBe(0);
    expect((await t.run(`select status from ${S()}.class_sessions where id = '${s}'`))[0].status).toBe("cancelled");

    expect(mocks.sendSms).toHaveBeenCalledTimes(2);
    expect(mocks.sendSms.mock.calls.map((x) => x[0].to).sort()).toEqual([a.phone, b.phone].sort());
    for (const [arg] of mocks.sendSms.mock.calls) {
      expect(arg.messageType).toBe("class_cancelled");
      expect(arg.body).toContain("is cancelled");
      expect(arg.body).toMatch(/^[\x20-\x7E]+$/);
    }
    // A cancelled class takes no more spots, and cancelling twice is refused.
    expect(await enroll(s, a.id)).toEqual({ error: "CLOSED" });
    expect(await lib.cancelSession(t.slug, s)).toMatchObject({ success: false });
  });

  itDb("7. createClassSessions repeats weekly with one block each, and a conflict writes nothing", async () => {
    const svc = await one(
      `insert into ${S()}.services (name, default_duration_minutes, is_class, class_capacity) values ('Spin', 45, 1, 10) returning id`,
    );
    const staff2 = await one(`insert into ${S()}.staff (display_name) values ('Sam Coach') returning id`);
    const date = new Date(Date.now() + 10 * 24 * HOUR).toISOString().slice(0, 10);
    const input = {
      serviceId: svc,
      staffId: staff2,
      locationId: null,
      resourceId: null,
      date,
      startTime: "10:00",
      capacity: 8,
      waitlistCapacity: 4,
      priceCents: 1500,
      repeatWeeks: 4 as const,
      allowConflicts: false,
    };

    // An appointment in week 3 (two weeks out) collides with the 10:00 to 10:45 class.
    const client = await mkClient("Booked Client");
    const clash = new Date(`${date}T10:15:00.000Z`);
    clash.setUTCDate(clash.getUTCDate() + 14);
    await t.run(
      `insert into ${S()}.appointments (staff_id, client_id, service_id, during) values ('${staff2}', '${client.id}', '${svc}', ${range(clash, 30)})`,
    );
    const blocked = await lib.createClassSessions(t.slug, input);
    expect("conflicts" in blocked).toBe(true);
    if ("conflicts" in blocked) {
      expect(blocked.conflicts).toHaveLength(1);
      const day = new Date(`${date}T00:00:00.000Z`);
      day.setUTCDate(day.getUTCDate() + 14);
      expect(blocked.conflicts[0]).toEqual({ date: day.toISOString().slice(0, 10), reason: "appointment" });
    }
    const none = async () => ({
      sessions: Number((await t.run(`select count(*)::int as n from ${S()}.class_sessions where service_id = '${svc}'`))[0].n),
      blocks: Number((await t.run(`select count(*)::int as n from ${S()}.time_blocks where staff_id = '${staff2}'`))[0].n),
    });
    expect(await none()).toEqual({ sessions: 0, blocks: 0 });

    // Without the clash: five sessions, five blocks, one series.
    await t.run(`delete from ${S()}.appointments where staff_id = '${staff2}'`);
    const ok = await lib.createClassSessions(t.slug, input);
    expect("sessionIds" in ok && ok.sessionIds).toHaveLength(5);
    expect(await none()).toEqual({ sessions: 5, blocks: 5 });
    const rows = await t.run(
      `select count(distinct s.series_id)::int as series, count(distinct s.time_block_id)::int as blocks,
              bool_and(b.label = 'Class: Spin') as labelled, bool_and(s.during = b.during) as same_time,
              bool_and(s.capacity = 8 and s.waitlist_capacity = 4 and s.price_cents = 1500) as settings
         from ${S()}.class_sessions s join ${S()}.time_blocks b on b.id = s.time_block_id where s.service_id = '${svc}'`,
    );
    expect(rows[0]).toEqual({ series: 1, blocks: 5, labelled: true, same_time: true, settings: true });

    // "Save anyway": an appointment clash is written over when conflicts are allowed.
    const aloneDay = new Date(`${date}T00:00:00.000Z`);
    aloneDay.setUTCDate(aloneDay.getUTCDate() + 3);
    const alone = aloneDay.toISOString().slice(0, 10);
    await t.run(
      `insert into ${S()}.appointments (staff_id, client_id, service_id, during) values ('${staff2}', '${client.id}', '${svc}', ${range(new Date(`${alone}T10:15:00.000Z`), 30)})`,
    );
    const single = { ...input, date: alone, repeatWeeks: 0 as const };
    expect(await lib.createClassSessions(t.slug, single)).toMatchObject({ conflicts: [{ reason: "appointment" }] });
    const forced = await lib.createClassSessions(t.slug, { ...single, allowConflicts: true });
    expect("sessionIds" in forced && forced.sessionIds).toHaveLength(1);

    // Another class block for the same person cannot be saved over, even with "Save anyway".
    const overlap = await lib.createClassSessions(t.slug, { ...single, allowConflicts: true });
    expect(overlap).toMatchObject({ conflicts: [{ date: alone, reason: "block" }] });
    expect((await none()).sessions).toBe(6);
  });

  itDb("createClassSessions rejects bad input and unknown services", async () => {
    const base = {
      serviceId: ids.svc, staffId: ids.staff, locationId: null, resourceId: null, date: "2030-01-07",
      startTime: "10:00", capacity: 5, waitlistCapacity: 0, priceCents: null, repeatWeeks: 0 as const, allowConflicts: false,
    };
    expect(await lib.createClassSessions(t.slug, { ...base, capacity: 0 })).toEqual({ error: "INVALID" });
    expect(await lib.createClassSessions(t.slug, { ...base, startTime: "25:00" })).toEqual({ error: "INVALID" });
    expect(await lib.createClassSessions(t.slug, { ...base, repeatWeeks: 5 as 4 })).toEqual({ error: "INVALID" });
    expect(await lib.createClassSessions(t.slug, { ...base, serviceId: "00000000-0000-4000-8000-000000000000" })).toEqual({ error: "NOT_FOUND" });
  });

  itDb("4. the ledger reconciles after everything above", async () => {
    const rows = await t.run(
      `SELECT cp.id FROM ${S()}.client_packages cp
        WHERE cp.credits_remaining <> COALESCE((SELECT sum(delta) FROM ${S()}.credit_ledger l WHERE l.client_package_id = cp.id), 0)
           OR cp.credits_remaining <> COALESCE((SELECT balance_after FROM ${S()}.credit_ledger l WHERE l.client_package_id = cp.id ORDER BY created_at DESC, id DESC LIMIT 1), 0)`,
    );
    expect(rows).toHaveLength(0);
    // Every class credit that is still out belongs to a live seat.
    const orphans = await t.run(
      `SELECT l.id FROM ${S()}.credit_ledger l
        WHERE l.reason = 'redeem' AND l.enrollment_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ${S()}.credit_ledger r WHERE r.reference_id = 'refund:' || l.id)
          AND NOT EXISTS (SELECT 1 FROM ${S()}.class_enrollments e WHERE e.id = l.enrollment_id AND e.status IN ('booked','attended','no_show','late_cancel'))`,
    );
    expect(orphans).toHaveLength(0);
  });
});
