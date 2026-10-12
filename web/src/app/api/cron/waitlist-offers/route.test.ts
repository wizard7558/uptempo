// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/tenant/registry", () => ({ listActiveTenants: async () => [] }));
vi.mock("@/lib/tenant/modules", () => ({ hasModule: async () => false }));
vi.mock("@/lib/waitlist/opening", () => ({ runWaitlistCron: async () => {} }));

describe("GET /api/cron/waitlist-offers", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  const call = async (headers?: Record<string, string>) => {
    const { GET } = await import("./route");
    return GET(new Request("http://localhost/api/cron/waitlist-offers", { headers }));
  };

  it("returns 401 without a bearer token", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
