// @vitest-environment node
import { randomBytes } from "node:crypto";
import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";
import { addDays, dayOfWeekOf, localDay, wallClockToDate } from "@/lib/scheduling/intervals";
import messages from "@/i18n/messages/en.json";

const itDb = process.env.DATABASE_URL ? it : it.skip;
// Each case makes many round trips to a remote database.
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({ slug: "" }));
const chargeDeposit = vi.hoisted(() => vi.fn());
const setBookingSession = vi.hoisted(() => vi.fn(async () => undefined));
const confirmations = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => state.slug }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
}));
vi.mock("@/lib/services/booking-deposits", () => ({ chargeBookingDepositForTenant: chargeDeposit }));
vi.mock("@/lib/booking/session-cookie", () => ({ setBookingSession }));
vi.mock("@/lib/booking/confirmations", () => ({ sendBookingConfirmations: confirmations }));
vi.mock("@/lib/calendar/sync-tenant", () => ({ pushBookingToCalendarForTenant: async () => undefined }));
vi.mock("@/lib/services/sync-auto-assistant-tasks", () => ({
  syncAutoAssistantTasksForAppointment: async () => undefined,
}));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: () => undefined }));
vi.mock("@/lib/tenant/modules", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant/modules")>("@/lib/tenant/modules");
  return { ...actual, hasModule: async () => true, assertModule: async () => undefined };
});
// Real copy from en.json so the tests assert on the sentences people see.
vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string, values?: Record<string, unknown>) => {
    let node: unknown = (messages as Record<string, unknown>)[ns];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    if (typeof node !== "string") return `${ns}.${key}`;
    return node.replace(/\{(\w+)\}/g, (m, k) => (k in (values ?? {}) ? String(values?.[k]) : m));
  },
}));

let t: ScratchTenant;
const ids = {} as Record<string, string>;
const s = () => `"${t.schema}"`;
const q1 = async (sqlText: string) => String((await t.run(sqlText))[0].id);

const TZ = "America/New_York";

/**
 * A Wednesday 19 to 26 local days out. The other cases in this file book
 * `slotStart(8)` through `slotStart(18)`, so this day stays clear of them
 * and inside the 28-day horizon.
 */
const quoteWednesday = () => {
  const today = localDay(new Date(), TZ);
  for (let n = 19; n <= 26; n++) {
    const day = addDays(today, n);
    if (dayOfWeekOf(day) === 3) return day;
  }
  throw new Error("no Wednesday left in the booking horizon");
};

/** 14:00 UTC (10:00 EDT / 09:00 EST) on the UTC day `n` days from now, n >= 8. */
const slotStart = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(14, 0, 0, 0);
  return d.toISOString();
};

/** A request with a sent quote: 240 min x $600 and 30 min x 2 x $50 (270 min, $700). */
async function sentQuote(opts: { staff?: string | null; client?: string; deposit?: number } = {}) {
  const client = opts.client ?? ids.client;
  const reqId = await q1(
    `insert into ${s()}.booking_requests (client_id, status, answers) values ('${client}', 'quoted', '{}') returning id`,
  );
  const token = randomBytes(24).toString("base64url");
  const staff = opts.staff === undefined ? ids.staff : opts.staff;
  const quoteId = await q1(
    `insert into ${s()}.quotes (request_id, staff_id, status, access_token, subtotal_cents, deposit_cents, valid_until, sent_at)
     values ('${reqId}', ${staff ? `'${staff}'` : "null"}, 'sent', '${token}', 70000, ${opts.deposit ?? 10000}, now() + interval '14 days', now())
     returning id`,
  );
  await t.run(
    `insert into ${s()}.quote_line_items (quote_id, service_id, description, quantity, unit_cents, minutes, sort) values
     ('${quoteId}', '${ids.sleeve}', 'Sleeve session', 1, 60000, 240, 0),
     ('${quoteId}', '${ids.flash}', 'Flash add-on', 2, 5000, 30, 1)`,
  );
  return { reqId, quoteId, token };
}

const accept = async (token: string, start: string, over: Record<string, unknown> = {}) => {
  const { acceptQuote } = await import("@/actions/quotes-public");
  return acceptQuote({
    token,
    start,
    staffId: ids.staff,
    acceptedName: "Casey Client",
    agree: true,
    ...over,
  });
};
const reqStatus = async (id: string) =>
  String((await t.run(`select status from ${s()}.booking_requests where id = '${id}'`))[0].status);

afterAll(async () => {
  if (t) await t.drop();
});

describe("accepting a quote against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("accept");
    state.slug = t.slug;
    ids.l1 = await q1(`select id from ${s()}.locations order by created_at limit 1`);
    ids.client = await q1(`insert into ${s()}.clients (name) values ('Casey Client') returning id`);
    ids.staff = await q1(`insert into ${s()}.staff (display_name) values ('Riley') returning id`);
    for (let dow = 0; dow <= 6; dow++) {
      await t.run(
        `insert into ${s()}.working_hours (staff_id, day_of_week, start_time, end_time, is_enabled, location_id) values ('${ids.staff}', ${dow}, '09:00', '17:00', 1, '${ids.l1}')`,
      );
    }
    ids.sleeve = await q1(
      `insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Half-day session', 240, 60000) returning id`,
    );
    ids.flash = await q1(
      `insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Flash', 60, 15000) returning id`,
    );
    for (const sv of [ids.sleeve, ids.flash]) {
      await t.run(`insert into ${s()}.staff_services (staff_id, service_id) values ('${ids.staff}', '${sv}')`);
    }
  }, 180_000);

  beforeEach(() => {
    chargeDeposit.mockReset();
    chargeDeposit.mockResolvedValue({ charged: true, status: "completed", amountCents: 10000 });
    setBookingSession.mockClear();
    confirmations.mockClear();
  });

  itDb("offers days and times that fit the quote's own length", async () => {
    const { token } = await sentQuote();
    const { getQuoteDays, getQuoteSlots } = await import("@/actions/quotes-public");
    const days = await getQuoteDays(token);
    expect(days.length).toBeGreaterThan(0);
    const slots = await getQuoteSlots(token, days[0]);
    expect(slots.length).toBeGreaterThan(0);
    // 270 minutes inside a 9:00-17:00 day: nothing may start after 12:30.
    const lastLocalHour = Math.max(
      ...slots.map((x) => Number(new Date(x.time).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }))),
    );
    expect(lastLocalHour).toBeLessThanOrEqual(12);
    expect(slots[0]).toMatchObject({ staffId: ids.staff, staffName: "Riley" });
    expect(await getQuoteSlots("short", days[0])).toEqual([]);
  });

  itDb("accept books the job with the quote's own lines and takes the deposit", async () => {
    const { reqId, quoteId, token } = await sentQuote();
    const start = slotStart(8);
    const res = await accept(token, start);
    expect(res).toMatchObject({ success: true, needsCard: false, depositPaid: true, depositCents: 10000 });
    if (!res.success) return;

    expect(await reqStatus(reqId)).toBe("converted");
    const [q] = await t.run(
      `select status, appointment_id, accepted_name, accepted_ip, accepted_at from ${s()}.quotes where id = '${quoteId}'`,
    );
    expect(q).toMatchObject({
      status: "accepted",
      appointment_id: res.appointmentId,
      accepted_name: "Casey Client",
      accepted_ip: "203.0.113.7",
    });
    expect(q.accepted_at).not.toBeNull();
    const [r] = await t.run(`select appointment_id from ${s()}.booking_requests where id = '${reqId}'`);
    expect(r.appointment_id).toBe(res.appointmentId);

    const [a] = await t.run(
      `select deposit_cents, lower(during) as s, upper(during) as e from ${s()}.appointments where id = '${res.appointmentId}'`,
    );
    expect(a.deposit_cents).toBe(10000);
    expect(new Date(String(a.e)).getTime() - new Date(String(a.s)).getTime()).toBe(270 * 60_000);

    const lines = await t.run(
      `select service_id, duration_minutes, price_charged_cents, is_override, notes from ${s()}.appointment_services where appointment_id = '${res.appointmentId}' order by duration_minutes desc`,
    );
    expect(lines).toEqual([
      { service_id: ids.sleeve, duration_minutes: 240, price_charged_cents: 60000, is_override: 1, notes: "Sleeve session" },
      { service_id: ids.flash, duration_minutes: 30, price_charged_cents: 10000, is_override: 1, notes: "Flash add-on" },
    ]);
    expect(chargeDeposit).toHaveBeenCalledWith(t.slug, res.appointmentId);
    expect(setBookingSession).not.toHaveBeenCalled();
    expect(confirmations).toHaveBeenCalledWith(t.slug, res.appointmentId);
    const [c] = await t.run(`select appointments_booked from ${s()}.clients where id = '${ids.client}'`);
    expect(c.appointments_booked).toBeGreaterThanOrEqual(1);
  });

  itDb("a quote with project sessions becomes a project holding the booked appointment", async () => {
    const { quoteId, reqId, token } = await sentQuote();
    await t.run(`update ${s()}.quotes set project_sessions = 4 where id = '${quoteId}'`);
    const res = await accept(token, slotStart(17));
    expect(res.success).toBe(true);
    if (!res.success) return;
    const [project] = await t.run(
      `select id, client_id, staff_id, request_id, title, status, est_sessions, quoted_total_cents, access_token from ${s()}.projects where request_id = '${reqId}'`,
    );
    expect(project).toMatchObject({
      client_id: ids.client,
      staff_id: ids.staff,
      title: "Sleeve session",
      status: "scheduled",
      est_sessions: 4,
      quoted_total_cents: 70000,
    });
    expect(String(project.access_token)).toHaveLength(32);
    const [a] = await t.run(`select project_id from ${s()}.appointments where id = '${res.appointmentId}'`);
    expect(a.project_id).toBe(project.id);
  });

  itDb("a quote without project sessions makes no project", async () => {
    const { reqId, token } = await sentQuote();
    const res = await accept(token, slotStart(18));
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(await t.run(`select id from ${s()}.projects where request_id = '${reqId}'`)).toEqual([]);
    const [a] = await t.run(`select project_id from ${s()}.appointments where id = '${res.appointmentId}'`);
    expect(a.project_id).toBeNull();
  });

  itDb("two concurrent accepts: exactly one wins", async () => {
    const { reqId, token } = await sentQuote();
    const start = slotStart(9);
    const results = await Promise.all([accept(token, start), accept(token, start)]);
    const ok = results.filter((r) => r.success);
    const lost = results.filter((r) => !r.success);
    expect(ok).toHaveLength(1);
    expect(lost).toEqual([{ success: false, error: messages.errors.requests.alreadyAccepting }]);
    expect(await reqStatus(reqId)).toBe("converted");
    const [{ n }] = await t.run(
      `select count(*)::int as n from ${s()}.appointments where lower(during) = '${start}'`,
    );
    expect(n).toBe(1);
  });

  itDb("a taken slot releases the claim so the client can pick another time", async () => {
    const { reqId, quoteId, token } = await sentQuote();
    const start = slotStart(10);
    await t.run(
      `insert into ${s()}.appointments (staff_id, client_id, location_id, during, status)
       values ('${ids.staff}', '${ids.client}', '${ids.l1}', tstzrange('${start}', '${new Date(new Date(start).getTime() + 60 * 60_000).toISOString()}', '[)'), 'confirmed')`,
    );
    const res = await accept(token, start);
    expect(res).toEqual({ success: false, error: messages.errors.requests.slotTaken });
    expect(await reqStatus(reqId)).toBe("quoted");
    const [q] = await t.run(`select status, appointment_id from ${s()}.quotes where id = '${quoteId}'`);
    expect(q).toMatchObject({ status: "sent", appointment_id: null });
    expect(chargeDeposit).not.toHaveBeenCalled();

    const retry = await accept(token, slotStart(11));
    expect(retry.success).toBe(true);
    expect(await reqStatus(reqId)).toBe("converted");
  });

  itDb("a claim left behind by a crash heals after 10 minutes, not before", async () => {
    const { reqId, token } = await sentQuote();
    const start = slotStart(12);
    await t.run(
      `update ${s()}.booking_requests set status = 'accepted', updated_at = now() - interval '2 minutes' where id = '${reqId}'`,
    );
    expect(await accept(token, start)).toEqual({
      success: false,
      error: messages.errors.requests.alreadyAccepting,
    });
    expect(await reqStatus(reqId)).toBe("accepted");

    await t.run(
      `update ${s()}.booking_requests set updated_at = now() - interval '11 minutes' where id = '${reqId}'`,
    );
    const res = await accept(token, start);
    expect(res.success).toBe(true);
    expect(await reqStatus(reqId)).toBe("converted");
  });

  itDb("no saved card: books the job, sets the client session and asks for a card", async () => {
    const { token } = await sentQuote();
    chargeDeposit.mockResolvedValue({ charged: false, reason: "no_card" });
    const res = await accept(token, slotStart(13));
    expect(res).toMatchObject({ success: true, needsCard: true, depositPaid: false, depositCents: 10000 });
    expect(setBookingSession).toHaveBeenCalledWith(ids.client);
  });

  itDb("a quote with no deposit never touches payment", async () => {
    const { token } = await sentQuote({ deposit: 0 });
    const res = await accept(token, slotStart(14));
    expect(res).toMatchObject({ success: true, needsCard: false, depositPaid: false, depositCents: 0 });
    expect(chargeDeposit).not.toHaveBeenCalled();
  });

  itDb("rejects bad input, a different person than the quote names, and closed quotes", async () => {
    const { token, quoteId } = await sentQuote();
    const start = slotStart(15);
    const bad = { success: false, error: messages.errors.requests.acceptInvalid };
    expect(await accept(token, start, { agree: false })).toEqual(bad);
    expect(await accept(token, start, { acceptedName: "A" })).toEqual(bad);
    const other = await q1(`insert into ${s()}.staff (display_name) values ('Sam') returning id`);
    expect(await accept(token, start, { staffId: other })).toEqual({
      success: false,
      error: messages.errors.requests.staffMismatch,
    });
    await t.run(`update ${s()}.quotes set valid_until = now() - interval '1 hour' where id = '${quoteId}'`);
    expect(await accept(token, start)).toEqual({ success: false, error: messages.errors.requests.quoteClosed });
  });

  itDb("the page data reflects each state, and 'No thanks' declines", async () => {
    const { getQuoteForPage, declineQuote } = await import("@/actions/quotes-public");
    const { reqId, token } = await sentQuote();
    const open = await getQuoteForPage(token);
    expect(open).toMatchObject({ state: "open", clientFirstName: "Casey" });
    expect(open.quote).toMatchObject({ subtotalCents: 70000, depositCents: 10000 });
    expect(open.lines).toHaveLength(2);

    expect(await declineQuote(token)).toEqual({ success: true });
    expect(await reqStatus(reqId)).toBe("declined");
    expect((await getQuoteForPage(token)).state).toBe("declined");
    expect(await declineQuote(token)).toEqual({ success: false });

    expect((await getQuoteForPage("nope")).state).toBe("unavailable");
    expect((await getQuoteForPage(randomBytes(24).toString("base64url"))).state).toBe("unavailable");

    const expired = await sentQuote();
    await t.run(`update ${s()}.quotes set valid_until = now() - interval '1 day' where id = '${expired.quoteId}'`);
    expect((await getQuoteForPage(expired.token)).state).toBe("expired");
    expect(await reqStatus(expired.reqId)).toBe("expired");

    const done = await sentQuote();
    const res = await accept(done.token, slotStart(16));
    expect(res.success).toBe(true);
    const page = await getQuoteForPage(done.token);
    expect(page.state).toBe("accepted");
    expect(page.booked).toMatchObject({ timeLabel: expect.stringMatching(/^\d{1,2}:\d{2} [AP]M$/), staffName: "Riley" });
  });

  itDb("does not offer a start the booking check refuses because the color room is busy", async () => {
    const consult = await q1(
      `insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Consult', 15, 0) returning id`,
    );
    const color = await q1(
      `insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Color', 15, 8000) returning id`,
    );
    for (const sv of [consult, color]) {
      await t.run(`insert into ${s()}.staff_services (staff_id, service_id) values ('${ids.staff}', '${sv}')`);
    }
    const room = await q1(
      `insert into ${s()}.resources (kind, name, location_id) values ('room', 'Color room', '${ids.l1}') returning id`,
    );
    await t.run(
      `insert into ${s()}.service_resource_requirements (service_id, resource_kind) values ('${color}', 'room')`,
    );
    const day = quoteWednesday();
    const at = (hhmm: string) => wallClockToDate(day, hhmm, TZ).toISOString();
    const holder = await q1(`insert into ${s()}.staff (display_name) values ('Jordan') returning id`);
    const held = await q1(
      `insert into ${s()}.appointments (staff_id, client_id, location_id, during) values ('${holder}','${ids.client}','${ids.l1}', tstzrange('${at("10:30")}','${at("11:30")}','[)')) returning id`,
    );
    await t.run(
      `insert into ${s()}.appointment_resources (appointment_id, resource_id, during) values ('${held}','${room}', tstzrange('${at("10:30")}','${at("11:30")}','[)'))`,
    );

    const reqId = await q1(
      `insert into ${s()}.booking_requests (client_id, status, answers) values ('${ids.client}', 'quoted', '{}') returning id`,
    );
    const token = randomBytes(24).toString("base64url");
    const quoteId = await q1(
      `insert into ${s()}.quotes (request_id, staff_id, status, access_token, subtotal_cents, deposit_cents, valid_until, sent_at)
       values ('${reqId}', '${ids.staff}', 'sent', '${token}', 8000, 0, now() + interval '14 days', now()) returning id`,
    );
    await t.run(
      `insert into ${s()}.quote_line_items (quote_id, service_id, description, quantity, unit_cents, minutes, sort) values
       ('${quoteId}', '${consult}', 'Consult', 1, 0, 30, 0),
       ('${quoteId}', '${color}', 'Color', 1, 8000, 60, 1)`,
    );

    const { getQuoteSlots } = await import("@/actions/quotes-public");
    const { checkBooking, resolveBookingLocation } = await import("@/lib/scheduling/service");
    const lines = [
      { serviceId: consult, durationMinutes: 30 },
      { serviceId: color, durationMinutes: 60 },
    ];
    const bookingCheck = async (iso: string) => {
      const start = new Date(iso);
      const location = await resolveBookingLocation(t.slug, ids.staff, start, null);
      return checkBooking({
        slug: t.slug,
        staffId: ids.staff,
        start,
        services: lines,
        totalMinutes: 90,
        locationId: location?.id ?? null,
        mode: "public",
        clientId: ids.client,
      });
    };

    const refusedAt = at("10:00");
    const openAt = at("11:30");
    const times = (await getQuoteSlots(token, day)).map((slot) => slot.time);
    expect(times).not.toContain(refusedAt);
    expect(times).toContain(openAt);
    expect(await bookingCheck(refusedAt)).toEqual({ ok: false, reasons: ["RESOURCE_UNAVAILABLE"] });
    expect(await bookingCheck(openAt)).toEqual({
      ok: true,
      resources: [
        {
          resourceId: room,
          start: new Date(at("12:00")),
          end: new Date(at("13:00")),
        },
      ],
    });
  });
});
