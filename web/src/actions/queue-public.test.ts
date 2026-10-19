// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashPublicToken } from "@/lib/security/public-token";

const h = vi.hoisted(() => ({
  hasModule: vi.fn(),
  consumeRateLimit: vi.fn(),
  withTenantDb: vi.fn(),
  findClient: vi.fn(),
  createClient: vi.fn(),
  recordSmsConsent: vi.fn(),
  sendSms: vi.fn(),
  loadQueueBoard: vi.fn(),
  /** Results handed to successive withTenantDb calls. */
  results: [] as unknown[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));
vi.mock("@/lib/tenant/modules", () => ({ hasModule: h.hasModule }));
vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeRateLimit: h.consumeRateLimit }));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: h.withTenantDb }));
vi.mock("@/lib/clients/for-tenant", () => ({
  findClientByPhoneForTenant: h.findClient,
  createClientForTenant: h.createClient,
}));
vi.mock("@/lib/sms/consent", () => ({ recordSmsConsent: h.recordSmsConsent }));
vi.mock("@/actions/booking-public", () => ({ getBusinessBySlug: async () => ({ id: "s", name: "Salon", slug: "salon" }) }));
vi.mock("@/lib/sms/send", () => ({ sendSms: h.sendSms }));
vi.mock("@/lib/utils/after", () => ({ runAfterResponse: (fn: () => Promise<unknown>) => void fn() }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/queue/board", () => ({ loadQueueBoard: h.loadQueueBoard }));

import { joinQueue, leaveQueue } from "./queue-public";

const KIOSK = "kiosk-secret-token";
const base = {
  slug: "salon",
  locationId: null,
  name: "  Maria Lopez ",
  phone: "(555) 123-4567",
  serviceId: null,
  preferredStaffId: null,
  smsConsent: false,
};
const settings = (over: Record<string, unknown> = {}) => ({
  open: 1,
  maxWaiting: 30,
  textOnJoin: 0,
  kioskHash: hashPublicToken(KIOSK),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.results = [];
  h.hasModule.mockResolvedValue(true);
  h.consumeRateLimit.mockResolvedValue({ allowed: true });
  h.withTenantDb.mockImplementation(async () => h.results.shift());
  h.findClient.mockResolvedValue({ id: "c1" });
  h.sendSms.mockResolvedValue({ success: true });
  h.loadQueueBoard.mockResolvedValue({ waiting: [{ id: "e1", position: 2, waitMinutes: 15 }] });
});

/** settings, waiting count, insert id */
const happyDb = (s = settings()) => {
  h.results = [s, 0, "e1", undefined];
};

describe("joinQueue", () => {
  it("treats a filled honeypot as too many tries and writes nothing", async () => {
    const r = await joinQueue({ ...base, website: "http://spam.example" });
    expect(r).toEqual({ success: false, error: "errors.queue.tooMany" });
    expect(h.withTenantDb).not.toHaveBeenCalled();
  });

  it("refuses when the line is closed", async () => {
    h.results = [settings({ open: 0 })];
    expect(await joinQueue(base)).toEqual({ success: false, error: "errors.queue.closed" });
  });

  it("refuses when a rate limit is hit", async () => {
    h.results = [settings()];
    h.consumeRateLimit.mockResolvedValueOnce({ allowed: false });
    expect(await joinQueue(base)).toEqual({ success: false, error: "errors.queue.tooMany" });
    expect(h.recordSmsConsent).not.toHaveBeenCalled();
  });

  it("limits a phone number separately from the IP", async () => {
    h.results = [settings()];
    h.consumeRateLimit.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    const r = await joinQueue(base);
    expect(r).toEqual({ success: false, error: "errors.queue.tooMany" });
    expect(h.consumeRateLimit.mock.calls[1][0]).toMatchObject({ scope: "identifier", limit: 3 });
  });

  it("gives a matching kiosk token the 300 per hour limit, and a missing one 10", async () => {
    happyDb();
    await joinQueue({ ...base, kioskToken: KIOSK });
    expect(h.consumeRateLimit.mock.calls[0][0]).toMatchObject({
      scope: "ip",
      key: "queue_join:203.0.113.9",
      limit: 300,
    });
    happyDb();
    h.consumeRateLimit.mockClear();
    await joinQueue({ ...base, kioskToken: "wrong-token" });
    expect(h.consumeRateLimit.mock.calls[0][0]).toMatchObject({ limit: 10 });
  });

  it("rejects a phone number that can't be normalized", async () => {
    expect(await joinQueue({ ...base, phone: "abc" })).toEqual({
      success: false,
      error: "errors.queue.invalidPhone",
    });
    expect(h.withTenantDb).not.toHaveBeenCalled();
  });

  it("rejects an empty name", async () => {
    expect(await joinQueue({ ...base, name: "   " })).toEqual({
      success: false,
      error: "errors.queue.invalidName",
    });
  });

  it("refuses when the module is off", async () => {
    h.hasModule.mockResolvedValue(false);
    expect(await joinQueue(base)).toEqual({ success: false, error: "errors.queue.turnedOff" });
    expect(h.withTenantDb).not.toHaveBeenCalled();
  });

  it("refuses a malformed slug before anything else", async () => {
    expect(await joinQueue({ ...base, slug: "../x" })).toEqual({ success: false, error: "errors.queue.turnedOff" });
    expect(h.hasModule).not.toHaveBeenCalled();
  });

  it("refuses when the line is full", async () => {
    h.results = [settings({ maxWaiting: 2 }), 2];
    expect(await joinQueue(base)).toEqual({ success: false, error: "errors.queue.full" });
    expect(h.findClient).not.toHaveBeenCalled();
  });

  it("maps the duplicate-phone constraint to alreadyInLine", async () => {
    h.results = [settings(), 0];
    h.withTenantDb
      .mockImplementationOnce(async () => h.results.shift())
      .mockImplementationOnce(async () => h.results.shift())
      .mockRejectedValueOnce({ code: "23505", constraint_name: "queue_entries_phone_active_unique" });
    expect(await joinQueue(base)).toEqual({ success: false, error: "errors.queue.alreadyInLine" });
  });

  it("without consent records nothing and sends no text", async () => {
    happyDb(settings({ textOnJoin: 1 }));
    const r = await joinQueue({ ...base, smsConsent: false });
    expect(r).toMatchObject({ success: true, position: 2, waitMinutes: 15 });
    expect(h.recordSmsConsent).not.toHaveBeenCalled();
    expect(h.sendSms).not.toHaveBeenCalled();
  });

  it("with consent records it and texts the status link", async () => {
    happyDb(settings({ textOnJoin: 1 }));
    const r = await joinQueue({ ...base, smsConsent: true });
    expect(r.success).toBe(true);
    expect(h.recordSmsConsent).toHaveBeenCalledWith("salon", "c1", "+15551234567", "queue_join", "203.0.113.9");
    expect(h.sendSms).toHaveBeenCalledTimes(1);
    const call = h.sendSms.mock.calls[0][0];
    expect(call).toMatchObject({ to: "+15551234567", messageType: "queue_joined", tenantSlug: "salon" });
    if (r.success) expect(call.body).toContain(`/q/salon/e/${r.token}`);
  });

  it("never returns the token hash", async () => {
    happyDb();
    const r = await joinQueue(base);
    expect(JSON.stringify(r)).not.toContain("Hash");
    if (r.success) expect(JSON.stringify(r)).not.toContain(hashPublicToken(r.token));
  });
});

describe("leaveQueue", () => {
  it("ignores a token that is the wrong shape", async () => {
    expect(await leaveQueue("salon", "short")).toEqual({ success: false });
    expect(h.withTenantDb).not.toHaveBeenCalled();
  });

  it("refuses when the module is off", async () => {
    h.hasModule.mockResolvedValue(false);
    expect(await leaveQueue("salon", "a".repeat(32))).toEqual({ success: false, error: "errors.queue.turnedOff" });
  });
});
