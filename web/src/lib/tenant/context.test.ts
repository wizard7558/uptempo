import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headersGet = vi.hoisted(() => vi.fn());
const getSingleTenantSlug = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const select = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const where = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: async () => ({ get: headersGet }),
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession } },
}));
vi.mock("@/lib/db", () => ({ publicDb: { select } }));
vi.mock("@/lib/tenant/single", () => ({ getSingleTenantSlug }));

import { getTenantSlug, getTenantSlugOrNull } from "./context";

function setRequestHeaders({
  tenantSlug = null,
  hostname = "localhost",
}: {
  tenantSlug?: string | null;
  hostname?: string;
} = {}) {
  const values: Record<string, string | null> = {
    "x-tenant-slug": tenantSlug,
    "x-forwarded-host": hostname,
    host: hostname,
  };
  headersGet.mockImplementation((name: string) => values[name] ?? null);
}

function configurePreview(slug: string) {
  vi.stubEnv("UPTEMPO_MODE", "multi");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PREVIEW_TENANT_SLUG", slug);
  setRequestHeaders({ hostname: "preview-deployment.vercel.app" });
}

beforeEach(() => {
  vi.stubEnv("UPTEMPO_MODE", "multi");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("PREVIEW_TENANT_SLUG", undefined);
  headersGet.mockReset();
  getSingleTenantSlug.mockReset();
  getSession.mockReset().mockResolvedValue(null);
  select.mockReset().mockReturnValue({ from });
  from.mockReset().mockReturnValue({ where });
  where.mockReset().mockReturnValue({ limit });
  limit.mockReset().mockResolvedValue([]);
  setRequestHeaders();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getTenantSlug", () => {
  it("returns the single slug and ignores the header", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    setRequestHeaders({ tenantSlug: "other-business" });
    getSingleTenantSlug.mockResolvedValue("only-shop");
    await expect(getTenantSlug()).resolves.toBe("only-shop");
  });

  it("uses the request header before the authenticated user's tenant in multi mode", async () => {
    setRequestHeaders({ tenantSlug: "from-header" });
    getSession.mockResolvedValue({ user: { id: "staff-user" } });
    limit.mockResolvedValue([{ tenantSlug: "staff-business" }]);

    await expect(getTenantSlug()).resolves.toBe("from-header");
    expect(select).not.toHaveBeenCalled();
  });

  it("uses an explicitly configured preview slug after trimming it", async () => {
    configurePreview("  preview-business  ");

    await expect(getTenantSlugOrNull()).resolves.toBe("preview-business");
  });

  it.each([undefined, "", "   "])(
    "does not select a preview tenant when PREVIEW_TENANT_SLUG is %j",
    async (slug) => {
      vi.stubEnv("VERCEL_ENV", "preview");
      if (slug === undefined) {
        vi.stubEnv("PREVIEW_TENANT_SLUG", undefined);
      } else {
        vi.stubEnv("PREVIEW_TENANT_SLUG", slug);
      }
      setRequestHeaders({ hostname: "preview-deployment.vercel.app" });

      await expect(getTenantSlugOrNull()).resolves.toBeNull();
      await expect(getTenantSlug()).rejects.toThrow(
        "No tenant context -- request did not pass through tenant middleware",
      );
    },
  );

  it("prefers an authenticated user's tenant over the configured preview slug", async () => {
    configurePreview("preview-business");
    getSession.mockResolvedValue({ user: { id: "staff-user" } });
    limit.mockResolvedValue([{ tenantSlug: "staff-business" }]);

    await expect(getTenantSlugOrNull()).resolves.toBe("staff-business");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("does not use preview tenant configuration on production Vercel hostnames", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PREVIEW_TENANT_SLUG", "preview-business");
    setRequestHeaders({ hostname: "deployment.vercel.app" });

    await expect(getTenantSlugOrNull()).resolves.toBeNull();
  });

  it("does not use preview tenant configuration on unrelated hostnames", async () => {
    vi.stubEnv("PREVIEW_TENANT_SLUG", "preview-business");
    setRequestHeaders({ hostname: "uptempo.example" });

    await expect(getTenantSlugOrNull()).resolves.toBeNull();
  });
});
