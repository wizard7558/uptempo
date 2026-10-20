// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({ single: false }));
const reportSmsUsage = vi.hoisted(() => vi.fn());
const reconcileHostedBilling = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/billing/sms-usage", () => ({ reportSmsUsage }));
vi.mock("@/lib/billing/reconcile", () => ({ reconcileHostedBilling }));

const USAGE = { reported: ["a"], zero: [], skipped: [], failed: [] };
const RECONCILE = { checked: 1, created: [], synced: ["a"], failed: [] };

describe("GET /api/cron/report-sms-usage", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    state.single = false;
    reportSmsUsage.mockReset().mockResolvedValue(USAGE);
    reconcileHostedBilling.mockReset().mockResolvedValue(RECONCILE);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-06-15T02:30:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  const call = async (query = "", headers: Record<string, string> = { authorization: "Bearer test-secret" }) => {
    const { GET } = await import("./route");
    return GET(new Request(`http://localhost/api/cron/report-sms-usage${query}`, { headers }));
  };

  it("returns 401 without or with the wrong secret", async () => {
    expect((await call("", {})).status).toBe(401);
    expect((await call("", { authorization: "Bearer nope" })).status).toBe(401);
    expect(reportSmsUsage).not.toHaveBeenCalled();
  });

  it("reports yesterday (UTC) by default, then reconciles", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(reportSmsUsage).toHaveBeenCalledWith("2031-06-14");
    expect(reconcileHostedBilling).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ date: "2031-06-14", usage: USAGE, reconcile: RECONCILE });
  });

  it("passes a valid backfill date through", async () => {
    const res = await call("?date=2031-05-20");
    expect(res.status).toBe(200);
    expect(reportSmsUsage).toHaveBeenCalledWith("2031-05-20");
    // Oldest allowed day is exactly 30 days back.
    expect((await call("?date=2031-05-16")).status).toBe(200);
  });

  it.each([
    ["future", "2031-06-16"],
    ["today", "2031-06-15"],
    ["too old", "2031-05-15"],
    ["malformed", "June-1"],
    ["not a real date", "2031-02-30"],
  ])("rejects a %s date with 400", async (_name, date) => {
    const res = await call(`?date=${date}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(reportSmsUsage).not.toHaveBeenCalled();
    expect(reconcileHostedBilling).not.toHaveBeenCalled();
  });

  it("skips in single mode without calling anything", async () => {
    state.single = true;
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: "single_mode" });
    expect(reportSmsUsage).not.toHaveBeenCalled();
    expect(reconcileHostedBilling).not.toHaveBeenCalled();
  });

  it("still reconciles when usage reporting throws, then returns 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportSmsUsage.mockRejectedValue(new Error("stripe down"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(reconcileHostedBilling).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.usageError).toBe("stripe down");
    expect(body.reconcile).toEqual(RECONCILE);
    errorSpy.mockRestore();
  });
});
