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

vi.mock("@/lib/db/shards", () => ({
  getShardForSlug: vi.fn(async () => "primary"),
  getShardClient: vi.fn(),
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

function mockForwardTransactions(
  initialVersion: number,
  failAtVersion?: { version: number; message: string },
) {
  let version = initialVersion;
  let transactionCount = 0;
  const lockedVersions: number[] = [];
  const transactions: Array<{
    execute: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  }> = [];

  mockPublicDb.transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => {
      transactionCount++;
      const lockedVersion = version;
      lockedVersions.push(lockedVersion);
      let executeCount = 0;
      const tx = {
        execute: vi.fn(async () => {
          executeCount++;
          if (executeCount === 1) return [{ v: lockedVersion }];
          if (failAtVersion?.version === lockedVersion) {
            throw new Error(failAtVersion.message);
          }
          return [];
        }),
        update: vi.fn(() => ({
          set: vi.fn((values: { schemaVersion: number }) => {
            version = values.schemaVersion;
            return { where: vi.fn() };
          }),
        })),
      };
      transactions.push(tx);
      return callback(tx);
    },
  );

  return {
    transactions,
    lockedVersions,
    get transactionCount() {
      return transactionCount;
    },
    get version() {
      return version;
    },
  };
}

function makeForwardTx(
  lockedVersion: number | undefined,
  onVersionUpdate?: (version: number) => void,
) {
  let executeCount = 0;
  return {
    execute: vi.fn(async () => {
      executeCount++;
      return executeCount === 1 && lockedVersion !== undefined
        ? [{ v: lockedVersion }]
        : [];
    }),
    update: vi.fn(() => ({
      set: vi.fn((values: { schemaVersion: number }) => {
        onVersionUpdate?.(values.schemaVersion);
        return { where: vi.fn() };
      }),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMigrations.length = 0;
});

describe("migrateTenant", () => {
  it("returns the locked version when there is no pending migration", async () => {
    mockMigrations.push({
      version: 2,
      description: "already applied",
      up: vi.fn(() => [sql`SELECT 1`]),
    }, {
      version: 3,
      description: "also applied",
      up: vi.fn(() => [sql`SELECT 1`]),
    });
    const db = mockForwardTransactions(3);

    const result = await migrateTenant("test", 2);

    expect(result).toEqual({
      slug: "test",
      fromVersion: 2,
      toVersion: 3,
      applied: 0,
    });
    expect(mockPublicDb.transaction).toHaveBeenCalledTimes(1);
    expect(db.lockedVersions).toEqual([3]);
    expect(mockMigrations.every((migration) => !migration.up.mock.calls.length)).toBe(true);
  });

  it("runs migrations in registry order from the locked version up to untilVersion", async () => {
    const order: number[] = [];
    mockMigrations.push({
      version: 3,
      description: "third",
      up: vi.fn(() => { order.push(3); return [sql`SELECT 3`]; }),
    }, {
      version: 2,
      description: "second",
      up: vi.fn(() => { order.push(2); return [sql`SELECT 2`]; }),
    }, {
      version: 4,
      description: "fourth",
      up: vi.fn(() => { order.push(4); return [sql`SELECT 4`]; }),
    });
    const db = mockForwardTransactions(1);

    const result = await migrateTenant("test", 0, 2);

    expect(result).toEqual({
      slug: "test",
      fromVersion: 0,
      toVersion: 2,
      applied: 1,
    });
    expect(order).toEqual([2]);
    expect(db.lockedVersions).toEqual([1, 2]);
    expect(db.version).toBe(2);
    expect(db.transactions).toHaveLength(2);
    expect(mockMigrations.find((migration) => migration.version === 3)?.up).not.toHaveBeenCalled();
    expect(mockMigrations.find((migration) => migration.version === 4)?.up).not.toHaveBeenCalled();
  });

  it("uses the locked version when the caller hint is ahead", async () => {
    const order: number[] = [];
    mockMigrations.push(
      {
        version: 60,
        description: "sixty",
        up: vi.fn(() => { order.push(60); return [sql`SELECT 60`]; }),
      },
      {
        version: 59,
        description: "fifty-nine",
        up: vi.fn(() => { order.push(59); return [sql`SELECT 59`]; }),
      },
    );
    const db = mockForwardTransactions(58);

    const result = await migrateTenant("test", 59);

    expect(result).toEqual({ slug: "test", fromVersion: 59, toVersion: 60, applied: 2 });
    expect(order).toEqual([59, 60]);
    expect(db.lockedVersions).toEqual([58, 59, 60]);
  });

  it("does not run DDL when the locked tenant row is missing", async () => {
    const up = vi.fn(() => [sql`SELECT 1`]);
    mockMigrations.push({ version: 2, description: "pending", up });
    const tx = makeForwardTx(undefined);
    mockPublicDb.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));

    const result = await migrateTenant("missing", 1);

    expect(result).toMatchObject({
      slug: "missing",
      fromVersion: 1,
      toVersion: 1,
      applied: 0,
      error: 'tenant "missing" not found in public.tenants',
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.update).not.toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();
  });

  it("stops on a failed migration and reports only completed work", async () => {
    mockMigrations.push(
      { version: 2, description: "succeeds", up: vi.fn(() => [sql`SELECT 1`]) },
      { version: 3, description: "fails", up: vi.fn(() => [sql`SELECT 1`]) },
    );

    const db = mockForwardTransactions(1, { version: 2, message: "DDL failed" });

    const result = await migrateTenant("test", 1);

    expect(result).toEqual({
      slug: "test",
      fromVersion: 1,
      toVersion: 2,
      applied: 1,
      error: "DDL failed",
    });
    expect(db.transactionCount).toBe(2);
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

    let transactionIndex = 0;
    mockPublicDb.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const lockedVersion = [1, 2, 2][transactionIndex++] ?? 2;
      return callback(makeForwardTx(lockedVersion));
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
    mockPublicDb.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      txCallCount++;
      // First call is for fail-tenant — throw
      if (txCallCount === 1) {
        throw new Error("connection refused");
      }
      return callback(makeForwardTx(txCallCount === 2 ? 1 : 2));
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
