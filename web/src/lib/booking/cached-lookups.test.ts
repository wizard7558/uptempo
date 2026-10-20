import { beforeEach, describe, expect, it, vi } from "vitest";

const isTenantProvisionedMock = vi.fn();
const withTenantDbMock = vi.fn();

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));
vi.mock("@/lib/tenant/registry", () => ({
  isTenantProvisioned: isTenantProvisionedMock,
}));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: withTenantDbMock }));
vi.mock("@/actions/booking-public", () => ({ getBusinessBySlug: vi.fn() }));

describe("getBookingBrandingCached", () => {
  beforeEach(() => {
    isTenantProvisionedMock.mockReset();
    withTenantDbMock.mockReset();
  });

  it("returns null without querying tenant tables for an unknown slug", async () => {
    isTenantProvisionedMock.mockResolvedValue(false);
    const { getBookingBrandingCached } = await import("./cached-lookups");
    await expect(getBookingBrandingCached("does-not-exist")).resolves.toBeNull();
    expect(withTenantDbMock).not.toHaveBeenCalled();
  });

  it("queries the tenant schema for a provisioned tenant", async () => {
    isTenantProvisionedMock.mockResolvedValue(true);
    withTenantDbMock.mockResolvedValue({ primaryColor: "#fff" });
    const { getBookingBrandingCached } = await import("./cached-lookups");
    await expect(getBookingBrandingCached("real")).resolves.toEqual({
      primaryColor: "#fff",
    });
  });
});
