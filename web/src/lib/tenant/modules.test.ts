import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTenantBySlug: vi.fn(),
  getTenantSlug: vi.fn(),
}));

vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: mocks.getTenantBySlug,
}));
vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: mocks.getTenantSlug,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/terms/server", () => ({
  getT: async () => (k: string) => k,
}));

import {
  ModuleDisabledError,
  assertModule,
  getEnabledModules,
  getModuleRows,
  hasModule,
  requireModule,
} from "./modules";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getTenantSlug.mockResolvedValue("salon-x");
});

describe("hasModule", () => {
  it("is false for an unknown tenant", async () => {
    mocks.getTenantBySlug.mockResolvedValue(null);
    expect(await hasModule("nope", "aftercare")).toBe(false);
  });
  it("reflects the stored list", async () => {
    mocks.getTenantBySlug.mockResolvedValue({ modules: ["aftercare"] });
    expect(await hasModule("s", "aftercare")).toBe(true);
    expect(await hasModule("s", "storefront")).toBe(false);
  });
  it("is true for always-on modules", async () => {
    mocks.getTenantBySlug.mockResolvedValue({ modules: [] });
    expect(await hasModule("s", "memberships")).toBe(true);
  });
});

describe("getEnabledModules", () => {
  it("includes always-on and listed modules", async () => {
    mocks.getTenantBySlug.mockResolvedValue({ modules: ["storefront"] });
    expect(await getEnabledModules("s")).toEqual([
      "processing_time",
      "memberships",
      "storefront",
    ]);
  });
});

describe("requireModule", () => {
  it("redirects to Features when off", async () => {
    mocks.getTenantBySlug.mockResolvedValue({ modules: [] });
    await expect(requireModule("aftercare")).rejects.toThrow(
      "REDIRECT:/settings/modules?off=aftercare",
    );
  });
  it("passes when on", async () => {
    mocks.getTenantBySlug.mockResolvedValue({ modules: ["aftercare"] });
    await expect(requireModule("aftercare")).resolves.toBeUndefined();
  });
});

describe("assertModule", () => {
  it("throws ModuleDisabledError with moduleId when off", async () => {
    mocks.getTenantBySlug.mockResolvedValue({ modules: [] });
    const err = await assertModule("s", "storefront").catch((e) => e);
    expect(err).toBeInstanceOf(ModuleDisabledError);
    expect(err.moduleId).toBe("storefront");
  });
  it("resolves when on", async () => {
    mocks.getTenantBySlug.mockResolvedValue({ modules: ["storefront"] });
    await expect(assertModule("s", "storefront")).resolves.toBeUndefined();
  });
});

describe("getModuleRows", () => {
  it("drops planned modules and marks recommended from the pack", async () => {
    mocks.getTenantBySlug.mockResolvedValue({
      industry: "hair_salon",
      modules: ["aftercare"],
    });
    const { industryLabel, rows } = await getModuleRows("s");
    expect(industryLabel).toBeTruthy();
    expect(rows.map((r) => r.id)).toEqual([
      "processing_time",
      "classes",
      "walk_in_queue",
      "slot_waitlist",
      "on_site",
      "assistant_tasks",
      "memberships",
      "packages",
      "gift_cards",
      "storefront",
      "requests",
      "projects",
      "consent_id",
      "attachments",
      "aftercare",
    ]);
    expect(rows.find((r) => r.id === "aftercare")).toMatchObject({
      enabled: true,
      recommended: true,
    });
    expect(rows.find((r) => r.id === "storefront")?.enabled).toBe(false);
    expect(rows.find((r) => r.id === "processing_time")?.enabled).toBe(true);
  });
});
