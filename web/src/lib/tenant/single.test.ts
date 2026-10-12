import { beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  publicDb: {
    select: () => ({
      from: () => ({
        orderBy: () => ({ limit }),
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema/tenants", () => ({
  tenants: { slug: "slug", createdAt: "created_at" },
}));

import { clearSingleTenantSlugCache, getSingleTenantSlug } from "./single";

beforeEach(() => {
  clearSingleTenantSlugCache();
  limit.mockReset();
});

describe("getSingleTenantSlug", () => {
  it("keeps a found slug for the process", async () => {
    limit.mockResolvedValueOnce([{ slug: "ada" }]);
    await expect(getSingleTenantSlug()).resolves.toBe("ada");
    limit.mockResolvedValueOnce([{ slug: "other" }]);
    await expect(getSingleTenantSlug()).resolves.toBe("ada");
  });

  it("rechecks a missing tenant after 5 seconds", async () => {
    vi.useFakeTimers();
    try {
      limit.mockResolvedValue([]);
      await expect(getSingleTenantSlug()).resolves.toBeNull();
      limit.mockResolvedValueOnce([{ slug: "ada" }]);
      await expect(getSingleTenantSlug()).resolves.toBeNull();
      vi.advanceTimersByTime(5_000);
      await expect(getSingleTenantSlug()).resolves.toBe("ada");
    } finally {
      vi.useRealTimers();
    }
  });
});
