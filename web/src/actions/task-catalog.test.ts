import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ASSISTANT_TASKS } from "@/lib/services/default-assistant-tasks";

const mocks = vi.hoisted(() => ({
  getTenantSlug: vi.fn(),
  getTenantIndustry: vi.fn(),
  withTenantDb: vi.fn(),
  requireRole: vi.fn(),
  assertModule: vi.fn(),
  revalidatePath: vi.fn(),
  trackEvent: vi.fn(),
  eq: vi.fn((...args: unknown[]) => ({ op: "eq", args })),
  asc: vi.fn((...args: unknown[]) => ({ op: "asc", args })),
}));

vi.mock("@/lib/tenant/context", () => ({
  getTenantSlug: mocks.getTenantSlug,
}));

vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: mocks.withTenantDb,
}));

vi.mock("@/lib/tenant/industry", () => ({
  getTenantIndustry: mocks.getTenantIndustry,
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

vi.mock("@/lib/tenant/modules", () => ({
  assertModule: mocks.assertModule,
}))

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/analytics/events", () => ({
  trackEvent: mocks.trackEvent,
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: mocks.eq,
    asc: mocks.asc,
  };
});

import { seedDefaultTaskTypes } from "./task-catalog";

const taskCatalogTable = {
  id: "task_catalog.id",
  name: "task_catalog.name",
  isActive: "task_catalog.is_active",
};

function createMockDb(existingNames: string[]) {
  let insertedValues: Array<{
    name: string;
    defaultDurationMinutes: number;
  }> = [];

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(
      existingNames.map((name) => ({
        name,
      })),
    ),
  };

  const insertChain = {
    values: vi.fn((values) => {
      insertedValues = Array.isArray(values) ? values : [values];
      return insertChain;
    }),
    returning: vi.fn(async () =>
      insertedValues.map((_, index) => ({
        id: `task-${index}`,
      })),
    ),
  };

  const db = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
  };

  return { db, insertChain };
}

function mockTenantDb(db: ReturnType<typeof createMockDb>["db"]) {
  mocks.withTenantDb.mockImplementation(
    async (
      _slug: string,
      callback: (dbArg: unknown, tablesArg: unknown) => unknown,
    ) => callback(db, { taskCatalog: taskCatalogTable }),
  );
}

describe("seedDefaultTaskTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ tenantSlug: "test-business" });
    mocks.getTenantSlug.mockResolvedValue("fallback-business");
    mocks.getTenantIndustry.mockResolvedValue("hair_salon");
    mocks.assertModule.mockResolvedValue(undefined);
  });

  it("seeds all default task types when the active catalog is empty", async () => {
    const { db, insertChain } = createMockDb([]);
    mockTenantDb(db);

    await expect(seedDefaultTaskTypes()).resolves.toEqual({
      success: true,
      created: DEFAULT_ASSISTANT_TASKS.length,
    });

    expect(mocks.requireRole).toHaveBeenCalledWith("owner", "admin");
    expect(mocks.assertModule).toHaveBeenCalledWith("test-business", "assistant_tasks");
    expect(mocks.getTenantIndustry).toHaveBeenCalledWith("test-business");
    expect(insertChain.values).toHaveBeenCalledWith(DEFAULT_ASSISTANT_TASKS);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/assistants");
  });

  it("is idempotent when defaults already exist", async () => {
    const { db } = createMockDb(
      DEFAULT_ASSISTANT_TASKS.map((task) => task.name),
    );
    mockTenantDb(db);

    await expect(seedDefaultTaskTypes()).resolves.toEqual({
      success: true,
      created: 0,
    });

    expect(db.insert).not.toHaveBeenCalled();
    expect(mocks.trackEvent).not.toHaveBeenCalled();
  });

  it("skips pre-existing task names case-insensitively", async () => {
    const { db, insertChain } = createMockDb(["  ShAmPoO  "]);
    mockTenantDb(db);

    await expect(seedDefaultTaskTypes()).resolves.toEqual({
      success: true,
      created: DEFAULT_ASSISTANT_TASKS.length - 1,
    });

    const inserted = insertChain.values.mock
      .calls[0]?.[0] as typeof DEFAULT_ASSISTANT_TASKS;
    expect(inserted.map((task) => task.name)).not.toContain("Shampoo");
    expect(inserted.map((task) => task.name)).toContain("All over gloss");
  });

  it("does not seed invented tasks for a pack with no task presets", async () => {
    const { db } = createMockDb([]);
    mockTenantDb(db);
    mocks.getTenantIndustry.mockResolvedValue("tattoo");

    await expect(seedDefaultTaskTypes()).resolves.toEqual({
      success: true,
      created: 0,
    });

    expect(mocks.getTenantIndustry).toHaveBeenCalledWith("test-business");
    expect(db.insert).not.toHaveBeenCalled();
    expect(mocks.trackEvent).not.toHaveBeenCalled();
  });

  it("checks module access before reading industry or opening the tenant database", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.assertModule.mockRejectedValueOnce(new Error("module off"));

    await expect(seedDefaultTaskTypes()).resolves.toMatchObject({
      success: false,
      error: "module off",
    });

    expect(mocks.getTenantIndustry).not.toHaveBeenCalled();
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("checks authorization before module, industry, or tenant database access", async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error("not authorized"));

    await expect(seedDefaultTaskTypes()).rejects.toThrow("not authorized");

    expect(mocks.assertModule).not.toHaveBeenCalled();
    expect(mocks.getTenantIndustry).not.toHaveBeenCalled();
    expect(mocks.withTenantDb).not.toHaveBeenCalled();
  });
});
