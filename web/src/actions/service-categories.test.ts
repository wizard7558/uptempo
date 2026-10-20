import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getTenantSlug: vi.fn(),
  getTenantIndustry: vi.fn(),
  requireStaff: vi.fn(),
  withTenantDb: vi.fn(),
  revalidatePath: vi.fn(),
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  asc: vi.fn((...args: unknown[]) => ({ op: "asc", args })),
  inArray: vi.fn((...args: unknown[]) => ({ op: "inArray", args })),
  categoryRows: [] as Array<Record<string, unknown>>,
  usedRows: [] as Array<{ slug: string }>,
  deleteCategory: null as Record<string, unknown> | null,
  updateSets: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: h.getTenantSlug }));
vi.mock("@/lib/tenant/industry", () => ({
  getTenantIndustry: h.getTenantIndustry,
}));
vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: h.requireStaff,
}));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: h.withTenantDb }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: h.eq,
    asc: h.asc,
    inArray: h.inArray,
  };
});

import { deleteServiceCategory, listServiceCategories } from "./service-categories";

const tables = {
  serviceCategories: { name: "service_categories", slug: "category.slug" },
  services: { name: "services", category: "services.category" },
};

function row(
  id: string,
  slug: string,
  name: string,
  isDefault = 0,
  sortOrder = 10,
) {
  return {
    id,
    slug,
    name,
    sortOrder,
    isDefault,
    isActive: 1,
  };
}

function mockDb() {
  const listQuery = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(async () => h.categoryRows),
    limit: vi.fn(async () => (h.deleteCategory ? [h.deleteCategory] : [])),
  };
  const usedQuery = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(async () => h.usedRows),
  };
  const db = {
    select: vi.fn(() => listQuery),
    selectDistinct: vi.fn(() => usedQuery),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        h.updateSets.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  h.withTenantDb.mockImplementation(
    async (
      _slug: string,
      callback: (dbArg: typeof db, tableArg: typeof tables) => unknown,
    ) => callback(db, tables),
  );
  return db;
}

describe("service category actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.categoryRows = [];
    h.usedRows = [];
    h.deleteCategory = null;
    h.updateSets = [];
    h.getTenantSlug.mockResolvedValue("context-tenant");
    h.getTenantIndustry.mockResolvedValue("tattoo");
    h.requireStaff.mockResolvedValue({ tenantSlug: "auth-tenant" });
  });

  it("hides only unused untouched hair defaults and marks pack categories default", async () => {
    h.categoryRows = [
      row("other-id", "other", "Other", 1, 10),
      row("pack-id", "custom", "Custom", 0, 20),
      row("business-id", "artist-choice", "Artist choice", 0, 30),
      row("renamed-id", "cut", "Artist designs", 1, 40),
      row("unused-id", "extensions", "Extensions", 1, 50),
      row("used-id", "color", "Color", 1, 60),
      row("unknown-id", "old-style", "Old style", 1, 70),
    ];
    h.usedRows = [{ slug: "color" }];
    const db = mockDb();

    const result = await listServiceCategories();

    expect(h.getTenantSlug).toHaveBeenCalledTimes(1);
    expect(h.getTenantIndustry).toHaveBeenCalledWith("context-tenant");
    expect(h.withTenantDb).toHaveBeenCalledWith("context-tenant", expect.any(Function));
    expect(result.map((category) => category.slug)).toEqual([
      "other",
      "custom",
      "artist-choice",
      "cut",
      "color",
      "old-style",
    ]);
    expect(result.map((category) => category.sortOrder)).toEqual([
      10, 20, 30, 40, 60, 70,
    ]);
    expect(result.find((category) => category.slug === "custom")?.isDefault).toBe(
      true,
    );
    expect(result.find((category) => category.slug === "artist-choice")?.isDefault).toBe(
      false,
    );
    expect(result.find((category) => category.slug === "color")?.isDefault).toBe(
      true,
    );
    expect(db.selectDistinct).toHaveBeenCalledTimes(1);
    expect(h.inArray).toHaveBeenCalledWith(tables.services.category, [
      "extensions",
      "color",
    ]);
  });

  it("skips the service reference query when there are no suppression candidates", async () => {
    h.categoryRows = [row("other-id", "other", "Other", 1)];
    const db = mockDb();

    await listServiceCategories();

    expect(db.selectDistinct).not.toHaveBeenCalled();
  });

  it("protects current pack categories even when their stored default flag is false", async () => {
    h.deleteCategory = row("tattoo-category", "custom", "Custom", 0);
    const db = mockDb();

    await expect(deleteServiceCategory("tattoo-category")).resolves.toMatchObject({
      success: false,
      error: { message: "Default categories can't be deleted" },
    });

    expect(h.requireStaff).toHaveBeenCalledTimes(1);
    expect(h.getTenantIndustry).toHaveBeenCalledWith("auth-tenant");
    expect(h.withTenantDb).toHaveBeenCalledWith("auth-tenant", expect.any(Function));
    expect(db.update).not.toHaveBeenCalled();
  });

  it("keeps custom-category deletion behavior inside the authenticated tenant", async () => {
    h.deleteCategory = row("custom-category", "artist-choice", "Artist choice", 0);
    const db = mockDb();

    await expect(deleteServiceCategory("custom-category")).resolves.toEqual({
      success: true,
    });

    expect(h.withTenantDb).toHaveBeenCalledWith("auth-tenant", expect.any(Function));
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(h.updateSets).toEqual([
      { category: "other", updatedAt: expect.any(Date) },
      { isActive: 0, updatedAt: expect.any(Date) },
    ]);
    expect(h.revalidatePath).toHaveBeenCalledWith("/settings/services");
  });
});
