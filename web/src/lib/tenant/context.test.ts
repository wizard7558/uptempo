import { afterEach, describe, expect, it, vi } from "vitest";

const headersGet = vi.hoisted(() => vi.fn());
const getSingleTenantSlug = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: async () => ({ get: headersGet }),
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock("@/lib/db", () => ({ publicDb: {} }));
vi.mock("@/lib/tenant/single", () => ({ getSingleTenantSlug }));

import { getTenantSlug } from "./context";

afterEach(() => {
  vi.unstubAllEnvs();
  headersGet.mockReset();
  getSingleTenantSlug.mockReset();
});

describe("getTenantSlug", () => {
  it("returns the single slug and ignores the header", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    headersGet.mockReturnValue("other-salon");
    getSingleTenantSlug.mockResolvedValue("only-shop");
    await expect(getTenantSlug()).resolves.toBe("only-shop");
  });

  it("uses the request header in multi mode", async () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    headersGet.mockImplementation((name: string) =>
      name === "x-tenant-slug" ? "from-header" : null,
    );
    await expect(getTenantSlug()).resolves.toBe("from-header");
  });
});
