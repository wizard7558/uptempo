// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import type { ScratchTenant } from "@/lib/scheduling/db-fixtures";
import messages from "@/i18n/messages/en.json";

const itDb = process.env.DATABASE_URL ? it : it.skip;

const state = {
  slug: "",
  clientId: null as string | null,
  role: "owner" as "owner" | "provider",
  userId: "u-owner",
};
const deliverQuote = vi.fn(async () => undefined);

vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => state.slug }));
vi.mock("@/lib/booking/session-cookie", () => ({ getBookingSession: async () => state.clientId }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth/rbac", () => ({
  requireRole: async () => ({ userId: state.userId, role: state.role, tenantSlug: state.slug }),
  requireStaff: async () => ({ userId: state.userId, role: state.role, tenantSlug: state.slug }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/requests/deliver", async () => {
  const actual = await vi.importActual<typeof import("@/lib/requests/deliver")>("@/lib/requests/deliver");
  return { ...actual, deliverQuote: (...a: []) => deliverQuote(...a) };
});
vi.mock("@/lib/tenant/modules", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tenant/modules")>("@/lib/tenant/modules");
  return { ...actual, assertModule: async () => undefined, hasModule: async () => true };
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
let storageDir: string;
const ids = {} as Record<string, string>;
const s = () => `"${t.schema}"`;
const q1 = async (sqlText: string) => String((await t.run(sqlText))[0].id);

// 8-byte PNG signature plus padding: enough for the byte sniffer.
const png = (name = "ref.png") =>
  new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])], name, {
    type: "image/png",
  });
const formWith = (file: File) => {
  const f = new FormData();
  f.set("file", file);
  return f;
};

afterAll(async () => {
  if (t) await t.drop();
  if (storageDir) fs.rmSync(storageDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("public requests against a real tenant schema", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) return;
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "req-files-"));
    vi.stubEnv("STORAGE_PROVIDER", "local");
    vi.stubEnv("STORAGE_LOCAL_DIR", storageDir);
    const { scratchTenant } = await import("@/lib/scheduling/db-fixtures");
    t = await scratchTenant("reqs");
    state.slug = t.slug;
    ids.a = await q1(`insert into ${s()}.clients (name) values ('Ava') returning id`);
    ids.b = await q1(`insert into ${s()}.clients (name) values ('Ben') returning id`);
    ids.c = await q1(`insert into ${s()}.clients (name) values ('Cy') returning id`);
  }, 180_000);

  itDb("orphan uploads are stored privately and expire in 24 hours", async () => {
    state.clientId = ids.a;
    const { uploadRequestPhoto } = await import("@/actions/requests-public");
    const one = await uploadRequestPhoto(formWith(png("one.png")));
    const two = await uploadRequestPhoto(formWith(png("two.png")));
    expect(one.success && two.success).toBe(true);
    if (!one.success || !two.success) return;
    ids.p1 = one.id;
    ids.p2 = two.id;
    const rows = await t.run(
      `select owner_id, is_private, storage_key, mime, extract(epoch from (delete_after - now())) as secs from ${s()}.attachments where client_id = '${ids.a}'`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.owner_id).toBeNull();
      expect(r.is_private).toBe(1);
      expect(r.mime).toBe("image/png");
      expect(String(r.storage_key)).toMatch(new RegExp(`^private/t/${t.slug}/request/`));
      expect(Math.abs(Number(r.secs) - 86400)).toBeLessThan(120);
      expect(fs.existsSync(path.join(storageDir, String(r.storage_key)))).toBe(true);
    }
  });

  itDb("rejects a file that is not an image", async () => {
    state.clientId = ids.a;
    const { uploadRequestPhoto } = await import("@/actions/requests-public");
    const res = await uploadRequestPhoto(formWith(new File(["hello"], "x.png", { type: "image/png" })));
    expect(res).toEqual({ success: false, error: messages.requests.uploadFailed });
  });

  itDb("requires a signed-in client", async () => {
    state.clientId = null;
    const { uploadRequestPhoto, submitBookingRequest } = await import("@/actions/requests-public");
    expect(await uploadRequestPhoto(formWith(png()))).toEqual({ success: false, error: messages.requests.signInFirst });
    const res = await submitBookingRequest({
      serviceId: null, staffId: null, answers: { description: "x" }, preferredWindows: [], attachmentIds: [],
    });
    expect(res).toEqual({ success: false, error: messages.requests.signInFirst });
  });

  itDb("submit creates the request, links the photos and keeps them", async () => {
    state.clientId = ids.a;
    const { submitBookingRequest } = await import("@/actions/requests-public");
    const res = await submitBookingRequest({
      serviceId: null,
      staffId: null,
      answers: { description: "Fix the gate" },
      preferredWindows: [{ days: [1, 3], parts: ["morning"] }],
      attachmentIds: [ids.p1, ids.p2],
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    ids.req = res.id;
    const [req] = await t.run(`select status, kind, answers, client_id from ${s()}.booking_requests where id = '${res.id}'`);
    expect(req).toMatchObject({ status: "new", kind: "quote", client_id: ids.a });
    expect(req.answers).toEqual({ description: "Fix the gate" });
    const linked = await t.run(`select owner_id, delete_after from ${s()}.attachments where id in ('${ids.p1}', '${ids.p2}')`);
    expect(linked).toHaveLength(2);
    for (const r of linked) {
      expect(r.owner_id).toBe(res.id);
      expect(r.delete_after).toBeNull();
    }
    const alerts = await t.run(`select title from ${s()}.alerts where dedupe_key = 'request_new:${res.id}'`);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("New request from Ava");
  });

  itDb("another client's attachment is rejected and nothing is written", async () => {
    state.clientId = ids.b;
    const { uploadRequestPhoto, submitBookingRequest } = await import("@/actions/requests-public");
    const up = await uploadRequestPhoto(formWith(png("ben.png")));
    expect(up.success).toBe(true);
    if (!up.success) return;
    state.clientId = ids.a;
    const res = await submitBookingRequest({
      serviceId: null, staffId: null, answers: { description: "Steal a photo" }, preferredWindows: [], attachmentIds: [up.id],
    });
    expect(res).toEqual({ success: false, error: messages.requests.photoMissing });
    const [{ n }] = await t.run(`select count(*)::int as n from ${s()}.booking_requests`);
    expect(n).toBe(1);
    const [{ owner_id }] = await t.run(`select owner_id from ${s()}.attachments where id = '${up.id}'`);
    expect(owner_id).toBeNull();
  });

  itDb("a photo can be removed only by its owner, and only before it is sent", async () => {
    state.clientId = ids.c;
    const { uploadRequestPhoto, removeRequestPhoto } = await import("@/actions/requests-public");
    const up = await uploadRequestPhoto(formWith(png("cy.png")));
    if (!up.success) throw new Error("upload failed");
    state.clientId = ids.a;
    expect((await removeRequestPhoto(up.id)).success).toBe(false);
    expect((await removeRequestPhoto(ids.p1)).success).toBe(false); // already part of a request
    state.clientId = ids.c;
    expect((await removeRequestPhoto(up.id)).success).toBe(true);
    const [row] = await t.run(`select deleted_at, storage_key from ${s()}.attachments where id = '${up.id}'`);
    expect(row.deleted_at).not.toBeNull();
    expect(fs.existsSync(path.join(storageDir, String(row.storage_key)))).toBe(false);
  });

  itDb("the 11th upload within an hour is rate limited", async () => {
    state.clientId = ids.b; // already has one orphan from the earlier test
    const { uploadRequestPhoto } = await import("@/actions/requests-public");
    for (let i = 0; i < 9; i++) {
      expect((await uploadRequestPhoto(formWith(png(`b${i}.png`)))).success).toBe(true);
    }
    const eleventh = await uploadRequestPhoto(formWith(png("one-too-many.png")));
    expect(eleventh).toEqual({ success: false, error: messages.requests.tooManyUploads });
  });
});

describe("quotes against a real tenant schema", () => {
  const newRequest = async (staffId: string | null = null) =>
    q1(
      `insert into ${s()}.booking_requests (client_id, staff_id, answers) values ('${ids.a}', ${staffId ? `'${staffId}'` : "null"}, '{"description":"Big job"}'::jsonb) returning id`,
    );
  const line = (serviceId: string, over: Record<string, unknown> = {}) => ({
    serviceId,
    description: "Work",
    quantity: 1,
    unitCents: 60000,
    minutes: 240,
    ...over,
  });
  const status = async (table: "quotes" | "booking_requests", id: string) =>
    String((await t.run(`select status from ${s()}.${table} where id = '${id}'`))[0].status);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !t) return;
    ids.svc = await q1(`insert into ${s()}.services (name, default_duration_minutes, price_cents) values ('Sleeve', 240, 60000) returning id`);
    ids.s1 = await q1(`insert into ${s()}.staff (display_name, user_id) values ('Mara', 'u-mara') returning id`);
    ids.s2 = await q1(`insert into ${s()}.staff (display_name, user_id) values ('Nico', 'u-nico') returning id`);
  });

  itDb("the detail shows the answers, the photos with signed links and the fields", async () => {
    state.role = "owner";
    const { getRequestDetail } = await import("@/actions/requests");
    const d = await getRequestDetail(ids.req);
    expect(d?.client.name).toBe("Ava");
    expect(d?.answers).toEqual({ description: "Fix the gate" });
    expect(d?.fields.map((f) => f.key)).toEqual(["description", "photos"]);
    expect(d?.photos).toHaveLength(2);
    expect(d?.photos[0].viewUrl).toMatch(new RegExp(`^/api/attachments/${t.slug}/[0-9a-f-]{36}\\?e=\\d+&s=`));
  });

  itDb("opening a new request marks it in review, once", async () => {
    const { markRequestReviewing, listRequests } = await import("@/actions/requests");
    await markRequestReviewing(ids.req);
    expect(await status("booking_requests", ids.req)).toBe("reviewing");
    const open = await listRequests("open");
    expect(open.map((r) => r.id)).toContain(ids.req);
    expect((await listRequests("booked")).map((r) => r.id)).not.toContain(ids.req);
  });

  itDb("saveQuoteDraft stores both lines and a subtotal of 70000", async () => {
    const { saveQuoteDraft } = await import("@/actions/requests");
    ids.r1 = await newRequest();
    const res = await saveQuoteDraft({
      requestId: ids.r1,
      staffId: null,
      depositCents: 10000,
      validDays: 14,
      lines: [line(ids.svc), line(ids.svc, { description: "Touch-up", quantity: 2, unitCents: 5000, minutes: 30 })],
    });
    expect(res.success).toBe(true);
    if (!res.success) return;
    ids.q1 = res.quoteId;
    const [q] = await t.run(`select status, subtotal_cents, deposit_cents, length(access_token) as len from ${s()}.quotes where id = '${ids.q1}'`);
    expect(q).toMatchObject({ status: "draft", subtotal_cents: 70000, deposit_cents: 10000 });
    expect(Number(q.len)).toBe(32);
    expect(await t.run(`select 1 from ${s()}.quote_line_items where quote_id = '${ids.q1}'`)).toHaveLength(2);

    // Saving again replaces the lines instead of adding to them.
    const again = await saveQuoteDraft({ requestId: ids.r1, quoteId: ids.q1, staffId: null, depositCents: 0, validDays: 7, lines: [line(ids.svc)] });
    expect(again).toEqual({ success: true, quoteId: ids.q1 });
    expect(await t.run(`select 1 from ${s()}.quote_line_items where quote_id = '${ids.q1}'`)).toHaveLength(1);
    expect(Number((await t.run(`select subtotal_cents from ${s()}.quotes where id = '${ids.q1}'`))[0].subtotal_cents)).toBe(60000);
    await saveQuoteDraft({
      requestId: ids.r1, quoteId: ids.q1, staffId: null, depositCents: 10000, validDays: 14,
      lines: [line(ids.svc), line(ids.svc, { description: "Touch-up", quantity: 2, unitCents: 5000, minutes: 30 })],
    });
  });

  itDb("a deposit above the total is refused in plain words", async () => {
    const { saveQuoteDraft } = await import("@/actions/requests");
    const res = await saveQuoteDraft({ requestId: ids.r1, staffId: null, depositCents: 60001, validDays: 14, lines: [line(ids.svc)] });
    expect(res).toEqual({ success: false, error: messages.errors.requests.depositTooHigh });
  });

  itDb("saveQuoteDraft keeps project sessions (2 to 12) and clears them with null", async () => {
    const { saveQuoteDraft } = await import("@/actions/requests");
    const base = { requestId: ids.r1, quoteId: ids.q1, staffId: null, depositCents: 0, validDays: 14 as const, lines: [line(ids.svc)] };
    const sessions = async () => (await t.run(`select project_sessions from ${s()}.quotes where id = '${ids.q1}'`))[0].project_sessions;
    expect(await saveQuoteDraft({ ...base, projectSessions: 5 })).toEqual({ success: true, quoteId: ids.q1 });
    expect(await sessions()).toBe(5);
    expect(await saveQuoteDraft({ ...base, projectSessions: 1 })).toMatchObject({ success: false });
    expect(await saveQuoteDraft({ ...base, projectSessions: 13 })).toMatchObject({ success: false });
    expect(await sessions()).toBe(5);
    expect(await saveQuoteDraft({ ...base, projectSessions: null })).toEqual({ success: true, quoteId: ids.q1 });
    expect(await sessions()).toBeNull();
    // Put the shared draft back the way later cases expect it.
    await saveQuoteDraft({
      ...base, depositCents: 10000,
      lines: [line(ids.svc), line(ids.svc, { description: "Touch-up", quantity: 2, unitCents: 5000, minutes: 30 })],
    });
  });

  itDb("a quote with no time cannot be sent", async () => {
    const { saveQuoteDraft, sendQuote } = await import("@/actions/requests");
    const draft = await saveQuoteDraft({ requestId: ids.r1, staffId: null, depositCents: 0, validDays: 14, lines: [line(ids.svc, { minutes: 0 })] });
    if (!draft.success) throw new Error("draft failed");
    expect(await sendQuote(draft.quoteId)).toEqual({ success: false, error: messages.errors.requests.needsTime });
    const { deleteQuoteDraft } = await import("@/actions/requests");
    expect(await deleteQuoteDraft(draft.quoteId)).toEqual({ success: true });
  });

  itDb("sendQuote sends it for 14 days and moves the request to quoted", async () => {
    const { sendQuote } = await import("@/actions/requests");
    expect(await sendQuote(ids.q1, 14)).toEqual({ success: true });
    expect(await status("quotes", ids.q1)).toBe("sent");
    expect(await status("booking_requests", ids.r1)).toBe("quoted");
    const [q] = await t.run(`select extract(epoch from (valid_until - sent_at)) / 86400 as days from ${s()}.quotes where id = '${ids.q1}'`);
    expect(Number(q.days)).toBeCloseTo(14, 2);
    expect(deliverQuote).toHaveBeenCalledTimes(1);
  });

  itDb("a sent quote cannot be edited or sent again", async () => {
    const { saveQuoteDraft, sendQuote } = await import("@/actions/requests");
    const edit = await saveQuoteDraft({ requestId: ids.r1, quoteId: ids.q1, staffId: null, depositCents: 0, validDays: 14, lines: [line(ids.svc)] });
    expect(edit).toEqual({ success: false, error: messages.errors.requests.badState });
    expect(await sendQuote(ids.q1)).toEqual({ success: false, error: messages.errors.requests.badState });
  });

  itDb("withdrawQuote sends the request back to review, and a second quote can then go out", async () => {
    const { withdrawQuote, saveQuoteDraft, sendQuote } = await import("@/actions/requests");
    expect(await withdrawQuote(ids.q1)).toEqual({ success: true });
    expect(await status("quotes", ids.q1)).toBe("withdrawn");
    expect(await status("booking_requests", ids.r1)).toBe("reviewing");
    const second = await saveQuoteDraft({ requestId: ids.r1, staffId: null, depositCents: 0, validDays: 30, lines: [line(ids.svc)] });
    if (!second.success) throw new Error("draft failed");
    ids.q2 = second.quoteId;
    expect(await sendQuote(ids.q2, 30)).toEqual({ success: true });
    expect(await status("booking_requests", ids.r1)).toBe("quoted");
  });

  itDb("the database allows only one sent quote per request", async () => {
    await expect(
      t.run(
        `insert into ${s()}.quotes (request_id, status, access_token, sent_at, valid_until) values ('${ids.r1}', 'sent', 'forced-second-sent-token', now(), now() + interval '1 day')`,
      ),
    ).rejects.toThrow();
  });

  itDb("a quote past its date expires, and so does its request", async () => {
    const { listRequests } = await import("@/actions/requests");
    await t.run(`update ${s()}.quotes set valid_until = now() - interval '1 hour' where id = '${ids.q2}'`);
    const rows = await listRequests("closed");
    expect(rows.find((r) => r.id === ids.r1)?.status).toBe("expired");
    expect(await status("quotes", ids.q2)).toBe("expired");
  });

  itDb("declining withdraws any sent quote", async () => {
    const { declineRequest, saveQuoteDraft, sendQuote } = await import("@/actions/requests");
    // An expired request can be quoted again, then declined.
    const draft = await saveQuoteDraft({ requestId: ids.r1, staffId: null, depositCents: 0, validDays: 7, lines: [line(ids.svc)] });
    if (!draft.success) throw new Error("draft failed");
    expect(await sendQuote(draft.quoteId, 7)).toEqual({ success: true });
    expect(await declineRequest(ids.r1, "Not a fit")).toEqual({ success: true });
    expect(await status("quotes", draft.quoteId)).toBe("withdrawn");
    const [r] = await t.run(`select status, decline_reason from ${s()}.booking_requests where id = '${ids.r1}'`);
    expect(r).toEqual({ status: "declined", decline_reason: "Not a fit" });
    expect(await declineRequest(ids.r1)).toEqual({ success: false, error: messages.errors.requests.badState });
  });

  itDb("a provider can change only their own or unassigned requests", async () => {
    const { saveQuoteDraft, declineRequest, markRequestReviewing, getRequestDetail } = await import("@/actions/requests");
    const others = await newRequest(ids.s2);
    const mine = await newRequest(ids.s1);
    const open = await newRequest(null);
    state.role = "provider";
    state.userId = "u-mara";
    const input = { staffId: null, depositCents: 0, validDays: 14 as const, lines: [line(ids.svc)] };
    expect(await saveQuoteDraft({ requestId: others, ...input })).toEqual({ success: false, error: messages.errors.requests.notAllowed });
    expect(await declineRequest(others)).toEqual({ success: false, error: messages.errors.requests.notAllowed });
    await markRequestReviewing(others);
    expect(await status("booking_requests", others)).toBe("new");
    expect(await getRequestDetail(others)).toBeNull();
    expect((await saveQuoteDraft({ requestId: mine, ...input })).success).toBe(true);
    expect((await saveQuoteDraft({ requestId: open, ...input })).success).toBe(true);
    state.role = "owner";
    state.userId = "u-owner";
    expect((await saveQuoteDraft({ requestId: others, ...input })).success).toBe(true);
  });

  /** Home-services tenant that only travels to 10001 and 10002; safe to call twice. */
  const onSiteSetup = async () => {
    await t.run(`update public.tenants set industry = 'home_services' where slug = '${t.slug}'`);
    await t.run(
      `insert into ${s()}.service_areas (name, kind, postal_codes)
       select 'Core', 'postal_codes', '{10001,10002}'
        where not exists (select 1 from ${s()}.service_areas where name = 'Core')`,
    );
    state.clientId = ids.c;
    const { submitBookingRequest } = await import("@/actions/requests-public");
    return (postalCode: string) =>
      submitBookingRequest({
        serviceId: null,
        staffId: null,
        answers: {
          description: "Clean the house",
          address: { line1: "1 Main St", city: "New York", region: "NY", postalCode },
        },
        preferredWindows: [],
        attachmentIds: [],
      });
  };

  itDb("on-site: a ZIP outside the service areas is refused and nothing is written", async () => {
    const submit = await onSiteSetup();
    const out = await submit("90210");
    expect(out).toEqual({
      success: false,
      error: messages.requests.outOfArea.replace("{zip}", "90210"),
    });
    const [r] = await t.run(
      `select (select count(*)::int from ${s()}.booking_requests where client_id = '${ids.c}') as requests,
              (select count(*)::int from ${s()}.client_addresses where client_id = '${ids.c}') as addresses`,
    );
    expect(r).toEqual({ requests: 0, addresses: 0 });
  });

  itDb("on-site: a ZIP inside the service area saves the address on the request", async () => {
    const submit = await onSiteSetup();
    const ok = await submit("10001");
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    const [row] = await t.run(
      `select r.address_id, a.lat, a.lng, a.geo_source, a.is_default, a.postal_code
         from ${s()}.booking_requests r join ${s()}.client_addresses a on a.id = r.address_id
        where r.id = '${ok.id}'`,
    );
    expect(row.address_id).toBeTruthy();
    expect(Math.abs(Number(row.lat) - 40.75)).toBeLessThan(0.05);
    expect(Math.abs(Number(row.lng) - -73.997)).toBeLessThan(0.05);
    expect(row).toMatchObject({ geo_source: "postal_centroid", is_default: 1, postal_code: "10001" });

    // The client's second address is not the default.
    const again = await submit("10002");
    expect(again.success).toBe(true);
    const defaults = await t.run(
      `select postal_code, is_default from ${s()}.client_addresses where client_id = '${ids.c}' order by created_at`,
    );
    expect(defaults).toEqual([
      { postal_code: "10001", is_default: 1 },
      { postal_code: "10002", is_default: 0 },
    ]);
  });
});
