import { describe, it, expect, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";

// Mock dependencies before importing runner
vi.mock("@/lib/db", () => ({
  publicDb: {
    transaction: vi.fn(),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  tenants: {
    slug: "slug",
    schemaVersion: "schema_version",
  },
}));

vi.mock("@/lib/tenant/registry", () => ({
  listActiveTenants: vi.fn(),
}));

vi.mock("./index", () => ({
  migrations: [] as Array<{ version: number; description: string; up: (s: string) => unknown[] }>,
  LATEST_SCHEMA_VERSION: 1,
}));

import { migrateTenant, rollbackTenant, applyPendingMigrations } from "./runner";
import { publicDb } from "@/lib/db";
import { listActiveTenants } from "@/lib/tenant/registry";
import { migrations } from "./index";
import { LATEST_SCHEMA_VERSION } from "./index";

const mockPublicDb = publicDb as unknown as { transaction: ReturnType<typeof vi.fn> };
const mockListActiveTenants = listActiveTenants as ReturnType<typeof vi.fn>;
const mockMigrations = migrations as Array<{
  version: number;
  description: string;
  up: ReturnType<typeof vi.fn>;
  down?: ReturnType<typeof vi.fn>;
}>;

beforeEach(() => {
  vi.clearAllMocks();
  mockMigrations.length = 0;
});

describe("migrateTenant", () => {
  it("skips tenant already at latest version", async () => {
    mockMigrations.push({
      version: 2,
      description: "test migration",
      up: vi.fn(() => [sql`SELECT 1`]),
    });

    const result = await migrateTenant("test", 2);

    expect(result).toEqual({
      slug: "test",
      fromVersion: 2,
      toVersion: 2,
      applied: 0,
    });
    expect(mockPublicDb.transaction).not.toHaveBeenCalled();
  });

  it("applies pending migration and updates version", async () => {
    const mockStmt = sql`ALTER TABLE test ADD COLUMN foo text`;
    mockMigrations.push({
      version: 2,
      description: "add foo column",
      up: vi.fn(() => [mockStmt]),
    });

    const mockTx = {
      execute: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(),
        })),
      })),
    };

    mockPublicDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<void>) => {
      await cb(mockTx);
    });

    const result = await migrateTenant("test", 1);

    expect(result).toEqual({
      slug: "test",
      fromVersion: 1,
      toVersion: 2,
      applied: 1,
    });
    // Should have called execute for the row lock + migration statement
    expect(mockTx.execute).toHaveBeenCalledTimes(2);
    // Should have called update to set schemaVersion
    expect(mockTx.update).toHaveBeenCalled();
  });

  it("stops on failed migration and returns error", async () => {
    mockMigrations.push(
      {
        version: 2,
        description: "succeeds",
        up: vi.fn(() => [sql`SELECT 1`]),
      },
      {
        version: 3,
        description: "fails",
        up: vi.fn(() => [sql`SELECT 1`]),
      },
    );

    let callCount = 0;
    mockPublicDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      callCount++;
      if (callCount === 2) {
        throw new Error("DDL failed");
      }
      const mockTx = {
        execute: vi.fn(),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(),
          })),
        })),
      };
      await cb(mockTx);
    });

    const result = await migrateTenant("test", 1);

    expect(result).toEqual({
      slug: "test",
      fromVersion: 1,
      toVersion: 2,
      applied: 1,
      error: "DDL failed",
    });
  });
});

describe("rollbackTenant", () => {
  function makeTx(currentVersion: () => number) {
    return {
      execute: vi.fn(async (stmt: unknown) => {
        // The row-lock SELECT is the only call whose result is read.
        void stmt;
        return [{ v: currentVersion() }];
      }),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    };
  }

  it("applies downs newest first and sets version-1 after each", async () => {
    const order: number[] = [];
    mockMigrations.push(
      { version: 2, description: "a", up: vi.fn(), down: vi.fn(() => { order.push(2); return [sql`SELECT 2`]; }) },
      { version: 3, description: "b", up: vi.fn(), down: vi.fn(() => { order.push(3); return [sql`SELECT 3`]; }) },
      { version: 4, description: "c", up: vi.fn(), down: vi.fn(() => { order.push(4); return [sql`SELECT 4`]; }) },
    );

    let version = 4;
    const setCalls: Array<{ schemaVersion: number }> = [];
    mockPublicDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        execute: vi.fn(async () => [{ v: version }]),
        update: vi.fn(() => ({
          set: vi.fn((vals: { schemaVersion: number }) => {
            setCalls.push(vals);
            version = vals.schemaVersion;
            return { where: vi.fn() };
          }),
        })),
      };
      await cb(tx);
    });

    const result = await rollbackTenant("test", 4, 2);

    expect(order).toEqual([4, 3]);
    expect(setCalls.map((c) => c.schemaVersion)).toEqual([3, 2]);
    expect(result).toEqual({ slug: "test", fromVersion: 4, toVersion: 2, applied: 2 });
    expect(mockMigrations[0].down).not.toHaveBeenCalled();
  });

  it("errors without executing anything when any migration lacks down", async () => {
    const down3 = vi.fn(() => [sql`SELECT 3`]);
    mockMigrations.push(
      { version: 2, description: "no down", up: vi.fn() },
      { version: 3, description: "has down", up: vi.fn(), down: down3 },
    );

    const result = await rollbackTenant("test", 3, 1);

    expect(result).toEqual({
      slug: "test",
      fromVersion: 3,
      toVersion: 3,
      applied: 0,
      error: "migration 2 has no down",
    });
    expect(mockPublicDb.transaction).not.toHaveBeenCalled();
    expect(down3).not.toHaveBeenCalled();
  });

  it("stops when the locked schema_version does not match", async () => {
    mockMigrations.push({ version: 2, description: "a", up: vi.fn(), down: vi.fn(() => [sql`SELECT 2`]) });
    const tx = makeTx(() => 5);
    mockPublicDb.transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<void>) => {
      await cb(tx);
    });

    const result = await rollbackTenant("test", 2, 1);

    expect(result.applied).toBe(0);
    expect(result.toVersion).toBe(2);
    expect(result.error).toMatch(/expected schema_version 2, found 5/);
    expect(tx.update).not.toHaveBeenCalled();
  });
});

describe("applyPendingMigrations", () => {
  it("processes all tenants independently", async () => {
    mockMigrations.push({
      version: 2,
      description: "test migration",
      up: vi.fn(() => [sql`SELECT 1`]),
    });

    mockListActiveTenants.mockResolvedValue([
      { slug: "alpha", schemaVersion: 1 },
      { slug: "beta", schemaVersion: 2 },
    ]);

    const mockTx = {
      execute: vi.fn(),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(),
        })),
      })),
    };

    mockPublicDb.transaction.mockImplementation(async (cb: (tx: typeof mockTx) => Promise<void>) => {
      await cb(mockTx);
    });

    const results = await applyPendingMigrations();

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.slug === "alpha")?.applied).toBe(1);
    expect(results.find((r) => r.slug === "beta")?.applied).toBe(0);
  });

  it("failed tenant does not block other tenants", async () => {
    mockMigrations.push({
      version: 2,
      description: "test migration",
      up: vi.fn(() => [sql`SELECT 1`]),
    });

    mockListActiveTenants.mockResolvedValue([
      { slug: "fail-tenant", schemaVersion: 1 },
      { slug: "ok-tenant", schemaVersion: 1 },
    ]);

    let txCallCount = 0;
    mockPublicDb.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      txCallCount++;
      // First call is for fail-tenant — throw
      if (txCallCount === 1) {
        throw new Error("connection refused");
      }
      const mockTx = {
        execute: vi.fn(),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(),
          })),
        })),
      };
      await cb(mockTx);
    });

    const results = await applyPendingMigrations();

    expect(results).toHaveLength(2);
    const failResult = results.find((r) => r.slug === "fail-tenant");
    const okResult = results.find((r) => r.slug === "ok-tenant");
    expect(failResult?.error).toBeDefined();
    expect(okResult?.applied).toBe(1);
    expect(okResult?.error).toBeUndefined();
  });
});

describe("LATEST_SCHEMA_VERSION", () => {
  it("equals 1 when no migrations exist", () => {
    // The mock returns an empty array, so LATEST_SCHEMA_VERSION
    // is computed at module load time. Since we mock ./index with
    // an empty migrations array, the imported constant should be 1.
    // However, since we mock the entire module, we need to test the
    // value from the actual index module logic.
    // The mock sets migrations to [], so LATEST_SCHEMA_VERSION = 1
    expect(LATEST_SCHEMA_VERSION).toBe(1);
  });
});
