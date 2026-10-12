import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  hasModule: vi.fn(),
  loadRetail: vi.fn(),
  staff: vi.fn(),
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireRole: mocks.requireRole,
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: async () => "shop-x",
}));
vi.mock("@/lib/tenant/modules", () => ({ hasModule: mocks.hasModule }));
vi.mock("@/lib/revenue/retail", () => ({
  loadRetailRevenue: mocks.loadRetail,
}));
vi.mock("@/actions/checkout", () => ({ getStaffRevenue: mocks.staff }));

import { getRevenueReport } from "./revenue";

const range = { start: new Date("2026-01-01"), end: new Date("2026-01-31") };

describe("getRevenueReport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireRole.mockResolvedValue({ tenantSlug: "shop-x" });
    mocks.staff.mockResolvedValue([]);
  });

  it("requires owner or admin", async () => {
    mocks.hasModule.mockResolvedValue(false);
    mocks.loadRetail.mockResolvedValue({ salesCents: 0, orderCount: 0 });
    await getRevenueReport(range);
    expect(mocks.requireRole).toHaveBeenCalledWith("owner", "admin");
  });

  it("rejects when the role check fails", async () => {
    mocks.requireRole.mockRejectedValue(new Error("forbidden"));
    await expect(getRevenueReport(range)).rejects.toThrow("forbidden");
    expect(mocks.staff).not.toHaveBeenCalled();
  });

  it("retail is null when storefront is off and there are no sales", async () => {
    mocks.hasModule.mockResolvedValue(false);
    mocks.loadRetail.mockResolvedValue({ salesCents: 0, orderCount: 0 });
    expect((await getRevenueReport(range)).retail).toBeNull();
  });

  it("retail is present when storefront is off but there are sales", async () => {
    mocks.hasModule.mockResolvedValue(false);
    mocks.loadRetail.mockResolvedValue({ salesCents: 900, orderCount: 1 });
    expect((await getRevenueReport(range)).retail).toEqual({
      salesCents: 900,
      orderCount: 1,
    });
  });

  it("retail is present when storefront is on with zero sales", async () => {
    mocks.hasModule.mockResolvedValue(true);
    mocks.loadRetail.mockResolvedValue({ salesCents: 0, orderCount: 0 });
    expect((await getRevenueReport(range)).retail).toEqual({
      salesCents: 0,
      orderCount: 0,
    });
  });
});
