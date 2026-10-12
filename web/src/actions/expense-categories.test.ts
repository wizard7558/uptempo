import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  ensure: vi.fn(),
  list: vi.fn(),
  revalidatePath: vi.fn(),
  update: vi.fn(),
  rows: [] as unknown[][],
}));

vi.mock("@/lib/auth/rbac", () => ({
  requireRole: mocks.requireRole,
  requireStaff: async () => ({ userId: "u", role: "owner", tenantSlug: "salon-x" }),
  AuthError: class AuthError extends Error {
    code: string;
    constructor(code: string, message?: string) {
      super(message ?? code);
      this.name = "AuthError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: async () => "salon-x" }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/terms/server", () => ({ getT: async () => (k: string) => k }));
vi.mock("@/lib/expenses/seed", () => ({
  ensureExpenseCategories: mocks.ensure,
  listExpenseCategoryRows: mocks.list,
}));

// Each select() chain resolves to the next queued row set.
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: async (
    _slug: string,
    cb: (db: unknown, t: unknown) => Promise<unknown>,
  ) => {
    const select = () => {
      const chain: Record<string, unknown> = {};
      const result = () => Promise.resolve(mocks.rows.shift() ?? []);
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = result;
      chain.then = (res: (v: unknown) => unknown) => result().then(res);
      return chain;
    };
    const db = {
      select,
      insert: () => ({ values: vi.fn() }),
      update: () => ({
        set: (v: unknown) => ({ where: () => mocks.update(v) }),
      }),
    };
    const col = new Proxy({}, { get: (_t, k) => String(k) });
    return cb(db, { expenseCategories: col });
  },
}));

import {
  createExpenseCategory,
  setExpenseCategoryActive,
} from "./expense-categories";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [];
  mocks.requireRole.mockResolvedValue({ userId: "u", role: "owner", tenantSlug: "salon-x" });
});

describe("expense category actions", () => {
  it("require owner or admin", async () => {
    mocks.rows = [[{ slug: "other" }]];
    await setExpenseCategoryActive({ id: "1", active: false });
    expect(mocks.requireRole).toHaveBeenCalledWith("owner", "admin");
  });

  it("refuses to hide other", async () => {
    mocks.rows = [[{ slug: "other" }]];
    const res = await setExpenseCategoryActive({ id: "1", active: false });
    expect(res.success).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("hides a normal category", async () => {
    mocks.rows = [[{ slug: "rent" }]];
    const res = await setExpenseCategoryActive({ id: "1", active: false });
    expect(res).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ isActive: 0 }));
  });

  it("returns categoryExists for a duplicate name", async () => {
    mocks.rows = [[{ id: "existing" }]];
    const res = await createExpenseCategory({ name: "Rent" });
    expect(res).toEqual({ success: false, error: "expenses.categoryExists" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a name with no usable characters", async () => {
    const res = await createExpenseCategory({ name: "!!!" });
    expect(res).toEqual({ success: false, error: "categories.nameRequired" });
  });
});
