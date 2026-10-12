// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/tenant/registry", () => ({ listActiveTenants: async () => [] }));
vi.mock("@/lib/scheduling/recurrence", () => ({ materializeTenant: async () => ({}) }));

describe("GET /api/cron/materialize-recurrences", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it("returns 401 without a bearer token", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/cron/materialize-recurrences"));
    expect(res.status).toBe(401);
  });

  it("returns 401 with the wrong token", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/cron/materialize-recurrences", {
        headers: { authorization: "Bearer nope" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 with the right token", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/cron/materialize-recurrences", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
