// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ single: false }));
const runDueBillingSwitches = vi.hoisted(() => vi.fn());

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/billing/switch", () => ({ runDueBillingSwitches }));

describe("GET /api/cron/switch-billing", () => {
  const savedSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    state.single = false;
    runDueBillingSwitches.mockReset().mockResolvedValue({
      results: [{ slug: "studio", outcome: "switched" }],
      failures: 0,
    });
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
  });

  async function call(
    url = "http://localhost/api/cron/switch-billing",
    headers: Record<string, string> = { authorization: "Bearer test-secret" },
  ) {
    const { GET } = await import("./route");
    return GET(new Request(url, { headers }));
  }

  it("requires CRON_SECRET", async () => {
    expect((await call(undefined, {})).status).toBe(401);
    expect((await call(undefined, { authorization: "Bearer wrong" })).status).toBe(401);
    expect(runDueBillingSwitches).not.toHaveBeenCalled();
  });

  it("runs the server-timed job and ignores URL time parameters", async () => {
    const response = await call(
      "http://localhost/api/cron/switch-billing?now=2000-01-01T00%3A00%3A00Z",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [{ slug: "studio", outcome: "switched" }],
      failures: 0,
    });
    expect(runDueBillingSwitches).toHaveBeenCalledTimes(1);
    expect(runDueBillingSwitches).toHaveBeenCalledWith();
  });

  it("skips single mode without invoking the runner", async () => {
    state.single = true;
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      skipped: "single_mode",
      results: [],
      failures: 0,
    });
    expect(runDueBillingSwitches).not.toHaveBeenCalled();
  });

  it("returns non-2xx when any tenant fails and keeps diagnostics bounded", async () => {
    runDueBillingSwitches.mockResolvedValue({
      results: [
        { slug: "studio", outcome: "failed", diagnostic: "switch_failed" },
        { slug: "salon", outcome: "switched" },
      ],
      failures: 1,
    });
    const response = await call();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0].diagnostic).toBe("switch_failed");
    expect(JSON.stringify(body)).not.toContain("@example.com");
  });
});
