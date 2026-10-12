import { describe, it, expect } from "vitest";
import {
  migrations,
  LATEST_SCHEMA_VERSION,
  TENANT_BASELINE_VERSION,
  getMigrationsAfterBaseline,
} from "./index";

/**
 * Guardrails: every tenant DDL change should add a migration and bump the registry.
 * New tenants are provisioned at LATEST_SCHEMA_VERSION; existing tenants rely on
 * migrate-tenants runner + public.tenants.schema_version.
 */
describe("tenant migration registry", () => {
  it("has unique, sorted versions starting at 2 with no gaps", () => {
    const versions = migrations.map((m) => m.version);
    const sorted = [...versions].sort((a, b) => a - b);
    expect(versions).toEqual(sorted);
    expect(new Set(versions).size).toBe(versions.length);

    if (versions.length === 0) return;
    expect(versions[0]).toBe(2);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBe(versions[i - 1] + 1);
    }
  });

  it("LATEST_SCHEMA_VERSION matches the last migration", () => {
    if (migrations.length === 0) {
      expect(LATEST_SCHEMA_VERSION).toBe(1);
      return;
    }
    expect(LATEST_SCHEMA_VERSION).toBe(migrations[migrations.length - 1].version);
  });

  it("provisioning applies every registry migration above the baseline, ending at LATEST", () => {
    const toApply = getMigrationsAfterBaseline();
    expect(toApply).toEqual(
      migrations.filter((m) => m.version > TENANT_BASELINE_VERSION),
    );
    expect(toApply.length).toBeGreaterThan(0);
    expect(toApply[0].version).toBe(TENANT_BASELINE_VERSION + 1);
    expect(toApply[toApply.length - 1].version).toBe(LATEST_SCHEMA_VERSION);
    const versions = toApply.map((m) => m.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
  });

  it("includes the migrations that were previously skipped (33-39)", () => {
    const versions = getMigrationsAfterBaseline().map((m) => m.version);
    for (const v of [33, 34, 35, 36, 37, 38, 39]) {
      expect(versions).toContain(v);
    }
  });

  it("every migration from version 40 defines down", () => {
    for (const m of migrations.filter((x) => x.version >= 40)) {
      expect(typeof m.down).toBe("function");
    }
  });
});
