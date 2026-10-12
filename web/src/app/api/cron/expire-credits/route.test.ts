// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/tenant/registry", () => ({ listActiveTenants: async () => [] }));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: async () => [] }));

describe("GET /api/cron/expire-credits", () => {
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
    return GET(new Request("http://localhost/api/cron/expire-credits", { headers }));
  };

  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call()).status).toBe(500);
  });

  it("returns 401 without a bearer token", async () => {
    expect((await call()).status).toBe(401);
  });

  it("returns 401 with the wrong token", async () => {
    expect((await call({ authorization: "Bearer nope" })).status).toBe(401);
  });

  it("returns 200 with the right token", async () => {
    const res = await call({ authorization: "Bearer test-secret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ expired: 0 });
  });
});
