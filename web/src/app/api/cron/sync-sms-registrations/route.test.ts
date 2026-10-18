// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ single: false, tenants: [] as Array<Record<string, unknown>> }));
const advanceRegistration = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/tenant/registry", () => ({ listActiveTenants: async () => state.tenants }));
vi.mock("@/lib/sms/registration", () => ({ advanceRegistration }));

describe("GET /api/cron/sync-sms-registrations", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    state.single = false;
    state.tenants = [];
    advanceRegistration.mockReset().mockResolvedValue({ ok: true, status: "pending" });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  const call = async (headers: Record<string, string> = { authorization: "Bearer test-secret" }) => {
    const { GET } = await import("./route");
    return GET(new Request("http://localhost/api/cron/sync-sms-registrations", { headers }));
  };

  it("requires the configured bearer secret", async () => {
    delete process.env.CRON_SECRET;
    expect((await call()).status).toBe(500);
    process.env.CRON_SECRET = "test-secret";
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect(advanceRegistration).not.toHaveBeenCalled();
  });

  it("skips in single mode", async () => {
    state.single = true;
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ skipped: "single_mode" });
    expect(advanceRegistration).not.toHaveBeenCalled();
  });

  it("advances pending and confirmation-waiting active tenants only", async () => {
    state.tenants = [
      { slug: "pending", status: "active", smsLineStatus: "pending", smsRegistration: {} },
      { slug: "confirm", status: "active", smsLineStatus: "action_needed", smsRegistration: { reason: "confirm_text" } },
      { slug: "rejected", status: "active", smsLineStatus: "action_needed", smsRegistration: { reason: "business_rejected" } },
      { slug: "shared", status: "active", smsLineStatus: "shared", smsRegistration: {} },
      { slug: "off", status: "active", smsLineStatus: "off", smsRegistration: {} },
      { slug: "inactive", status: "suspended", smsLineStatus: "pending", smsRegistration: {} },
    ];
    const response = await call();
    expect(response.status).toBe(200);
    expect(advanceRegistration.mock.calls).toEqual([["pending"], ["confirm"]]);
    expect(await response.json()).toMatchObject({ advanced: 2, failed: 0 });
  });

  it("continues after one tenant fails and does not expose thrown details", async () => {
    state.tenants = [
      { slug: "first", status: "active", smsLineStatus: "pending", smsRegistration: {} },
      { slug: "second", status: "active", smsLineStatus: "pending", smsRegistration: {} },
    ];
    advanceRegistration
      .mockRejectedValueOnce(new Error("sensitive request details"))
      .mockResolvedValueOnce({ ok: true, status: "pending" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ advanced: 1, failed: 1 });
    expect(JSON.stringify(body)).not.toContain("sensitive request details");
    expect(advanceRegistration).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
