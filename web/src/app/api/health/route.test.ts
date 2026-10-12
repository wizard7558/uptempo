import { afterEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  publicDb: { execute },
}));

import { GET } from "./route";

afterEach(() => {
  execute.mockReset();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /api/health", () => {
  it("reports the database, mode, and version", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    vi.stubEnv("UPTEMPO_VERSION", "1.2.3");
    execute.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      mode: "single",
      version: "1.2.3",
      db: "ok",
    });
  });

  it("returns 503 when the database check fails", async () => {
    execute.mockRejectedValue(new Error("connection refused"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, db: "error" });
  });

  it("returns 503 when the database does not answer within 3 seconds", async () => {
    vi.useFakeTimers();
    execute.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(3_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, db: "error" });
  });
});
