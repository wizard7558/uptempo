import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getTenantSlug: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  revalidatePath: vi.fn(),
  trackEvent: vi.fn(),
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
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: mocks.getTenantSlug }));
vi.mock("@/lib/db", () => ({ publicDb: { update: mocks.update } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: mocks.trackEvent }));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (k: string) => k,
}));

import { setModuleEnabled } from "./modules";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue({
    userId: "u",
    role: "owner",
    tenantSlug: "salon-x",
  });
  mocks.where.mockResolvedValue(undefined);
  mocks.set.mockReturnValue({ where: mocks.where });
  mocks.update.mockReturnValue({ set: mocks.set });
});

describe("setModuleEnabled", () => {
  it.each(["processing_time", "bogus"])(
    "rejects %s without writing",
    async (id) => {
      const res = await setModuleEnabled(id, true);
      expect(res).toEqual({ success: false, error: "modules.unknown" });
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );

  it("turns a toggle module on", async () => {
    const res = await setModuleEnabled("aftercare", true);
    expect(res).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ modules: expect.anything(), updatedAt: expect.any(Date) }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(mocks.trackEvent).toHaveBeenCalledWith(
      "module.toggled",
      { moduleId: "aftercare", enabled: true },
      { tenantSlug: "salon-x" },
    );
  });

  it("turns the waitlist on", async () => {
    expect(await setModuleEnabled("slot_waitlist", true)).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("turns session packs on", async () => {
    expect(await setModuleEnabled("packages", true)).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("turns a toggle module off", async () => {
    const res = await setModuleEnabled("storefront", false);
    expect(res).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("requires owner or admin", async () => {
    await setModuleEnabled("aftercare", true);
    expect(mocks.requireRole).toHaveBeenCalledWith("owner", "admin");
  });
});
