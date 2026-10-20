import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MARKERS,
  runRepairCommand,
  uncoveredRepairVersions,
  type RepairBackend,
  type RepairState,
  type RepairTenantInfo,
  type RepairTransaction,
  type TenantReport,
} from "./repair-tenant-schemas";

const dotenv = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock("dotenv", () => dotenv);

const tenant: RepairTenantInfo = {
  slug: "repair-fixture",
  status: "active",
  schemaVersion: 58,
  dbShard: "primary",
};

function reportWith(states: Record<number, RepairState>): TenantReport {
  return {
    ...tenant,
    schemaExists: true,
    states: new Map(Object.entries(states).map(([version, state]) => [Number(version), state])),
    partialDetail: new Map([[60, ["view stylists", "view projection differs"]]]),
    deferred: new Set(),
    applied: [],
    renamed0040: true,
  };
}

function cloneReport(report: TenantReport): TenantReport {
  return {
    ...report,
    states: new Map(report.states),
    partialDetail: new Map(report.partialDetail),
    deferred: new Set(report.deferred),
    applied: [...report.applied],
  };
}

function fakeBackend(
  report: TenantReport,
  selectedTenant: RepairTenantInfo = tenant,
  counts = { listings: 0, queries: 0, inspections: 0, transactions: 0, migrations: 0, versions: 0 },
  options: {
    lockedTenant?: RepairTenantInfo | null;
    inspectionReports?: TenantReport[];
    throwOnInspectionCall?: number;
  } = {},
): { backend: RepairBackend; counts: typeof counts } {
  const transaction: RepairTransaction = {
    execute: async () => { counts.queries++; return []; },
    lockTenant: async () => options.lockedTenant === undefined ? selectedTenant : options.lockedTenant,
    applyMigration: async () => { counts.migrations++; },
    setSchemaVersion: async () => { counts.versions++; },
  };
  return {
    counts,
    backend: {
      execute: async () => { counts.queries++; return []; },
      listTenants: async () => { counts.listings++; return [selectedTenant]; },
      inspectTenant: async () => {
        counts.inspections++;
        if (counts.inspections === options.throwOnInspectionCall) throw new Error("readback fixture failure");
        return cloneReport(options.inspectionReports?.[counts.inspections - 1] ?? report);
      },
      transaction: async (operation) => {
        counts.transactions++;
        return operation(transaction);
      },
    },
  };
}

describe("repair-tenant-schemas", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not load dotenv files or configure environment when imported", async () => {
    await import("./repair-tenant-schemas");
    expect(dotenv.config).not.toHaveBeenCalled();
  });

  it("covers the full registry including the v60 special inspector without a marker placeholder", async () => {
    const { migrations } = await import("../src/lib/tenant/migrations");
    const repairMigrations = migrations.filter((migration) => migration.version >= 33);
    expect(uncoveredRepairVersions(repairMigrations)).toEqual([]);
    expect(MARKERS).not.toHaveProperty("60");
    expect(uncoveredRepairVersions([...repairMigrations, { version: 61 }])).toEqual([61]);
  });

  it.each([false, true])("refuses the whole tenant when v60 is partial (apply=%s)", async (apply) => {
    const { migrations, LATEST_SCHEMA_VERSION } = await import("../src/lib/tenant/migrations");
    const states: Record<number, RepairState> = {};
    for (const migration of migrations.filter((item) => item.version >= 33)) states[migration.version] = "present";
    states[59] = "missing";
    states[60] = "partial";
    const { backend, counts } = fakeBackend(reportWith(states));

    const result = await runRepairCommand({
      apply,
      migrations: migrations.filter((migration) => migration.version >= 33),
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      backend,
    });

    expect(result.exitCode).toBe(1);
    expect(result.missingBefore.get(tenant.slug)).toContain(59);
    expect(result.reports[0].error).toContain("skipped all tenant apply work");
    expect(counts.transactions).toBe(0);
    expect(counts.migrations).toBe(0);
    expect(counts.versions).toBe(0);
  });

  it("fails registry coverage before tenant listing or inspection", async () => {
    const { migrations, LATEST_SCHEMA_VERSION } = await import("../src/lib/tenant/migrations");
    const { backend, counts } = fakeBackend(reportWith({ 60: "missing" }));
    const futureMigration = { version: 61, up: () => [] } as unknown as (typeof migrations)[number];
    const result = await runRepairCommand({
      apply: true,
      migrations: [...migrations.filter((migration) => migration.version >= 33), futureMigration],
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      backend,
    });
    expect(result.coverageFailures).toEqual([61]);
    expect(result.exitCode).toBe(1);
    expect(counts.listings).toBe(0);
    expect(counts.inspections).toBe(0);
    expect(counts.transactions).toBe(0);
    expect(counts.migrations).toBe(0);
    expect(counts.versions).toBe(0);
    expect(counts.queries).toBe(0);
  });

  it.each(["s2", "unknown-shard", null, undefined, "", "   "]) ("rejects unsupported shard %s before tenant-schema queries or writes", async (dbShard) => {
    const { migrations, LATEST_SCHEMA_VERSION } = await import("../src/lib/tenant/migrations");
    const nonPrimary = { ...tenant, dbShard } as RepairTenantInfo;
    const { backend, counts } = fakeBackend(reportWith({ 60: "missing" }), nonPrimary);
    const result = await runRepairCommand({
      apply: true,
      migrations: migrations.filter((migration) => migration.version >= 33),
      latestSchemaVersion: LATEST_SCHEMA_VERSION,
      backend,
    });
    expect(result.exitCode).toBe(1);
    expect(result.reports[0].error).toContain("primary-only repair was not attempted");
    expect(counts.inspections).toBe(0);
    expect(counts.queries).toBe(0);
    expect(counts.transactions).toBe(0);
    expect(counts.migrations).toBe(0);
    expect(counts.versions).toBe(0);
  });

  it("rechecks a missing migration under lock and writes nothing if the fresh v60 state is partial", async () => {
    const { migrations, LATEST_SCHEMA_VERSION } = await import("../src/lib/tenant/migrations");
    const versions = migrations.filter((migration) => migration.version >= 33);
    const initial: Record<number, RepairState> = {};
    const locked: Record<number, RepairState> = {};
    for (const migration of versions) {
      initial[migration.version] = "present";
      locked[migration.version] = "present";
    }
    initial[59] = "missing";
    initial[60] = "missing";
    locked[59] = "missing";
    locked[60] = "partial";
    const { backend, counts } = fakeBackend(reportWith(initial), tenant, undefined, {
      inspectionReports: [reportWith(initial), reportWith(locked)],
    });

    const result = await runRepairCommand({ apply: true, migrations: versions, latestSchemaVersion: LATEST_SCHEMA_VERSION, backend });

    expect(result.exitCode).toBe(1);
    expect(result.reports[0].error).toContain("rolled back");
    expect(counts.inspections).toBe(2);
    expect(counts.migrations).toBe(0);
    expect(counts.versions).toBe(0);
  });

  it("rechecks shard metadata under lock before inspection or writes", async () => {
    const { migrations, LATEST_SCHEMA_VERSION } = await import("../src/lib/tenant/migrations");
    const versions = migrations.filter((migration) => migration.version >= 33);
    const states: Record<number, RepairState> = {};
    for (const migration of versions) states[migration.version] = "present";
    states[60] = "missing";
    const { backend, counts } = fakeBackend(reportWith(states), tenant, undefined, {
      lockedTenant: { ...tenant, dbShard: "secondary" },
    });

    const result = await runRepairCommand({ apply: true, migrations: versions, latestSchemaVersion: LATEST_SCHEMA_VERSION, backend });

    expect(result.exitCode).toBe(1);
    expect(result.reports[0].error).toContain("after row lock");
    expect(counts.inspections).toBe(1);
    expect(counts.migrations).toBe(0);
    expect(counts.versions).toBe(0);
  });

  it("preserves committed versions and reports unavailable post-commit verification accurately", async () => {
    const { migrations, LATEST_SCHEMA_VERSION } = await import("../src/lib/tenant/migrations");
    const versions = migrations.filter((migration) => migration.version >= 33);
    const missing60: Record<number, RepairState> = {};
    const present: Record<number, RepairState> = {};
    for (const migration of versions) {
      missing60[migration.version] = "present";
      present[migration.version] = "present";
    }
    missing60[60] = "missing";
    const { backend, counts } = fakeBackend(reportWith(missing60), tenant, undefined, {
      inspectionReports: [reportWith(missing60), reportWith(missing60), reportWith(missing60), reportWith(present)],
      throwOnInspectionCall: 5,
    });

    const result = await runRepairCommand({ apply: true, migrations: versions, latestSchemaVersion: LATEST_SCHEMA_VERSION, backend });

    expect(result.exitCode).toBe(1);
    expect(result.reports[0].applied).toEqual([60]);
    expect(result.reports[0].schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(result.reports[0].states.get(60)).toBe("unknown");
    expect(result.reports[0].error).toContain(`transaction committed with schema_version ${LATEST_SCHEMA_VERSION}`);
    expect(result.reports[0].error).toContain("post-commit verification unavailable");
    expect(counts.migrations).toBe(1);
    expect(counts.versions).toBe(1);
  });
});
