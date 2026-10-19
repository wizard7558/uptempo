import { describe, expect, it } from "vitest";
import { migration } from "./0060-domain-compatibility";

describe("migration 0060 schema-name guard", () => {
  it("accepts safe historical and hyphenated tenant schema names", () => {
    expect(migration.up("tenant_valid-hyphenated")).toHaveLength(1);
    expect(migration.down!("tenant_valid-hyphenated")).toHaveLength(1);
    expect(migration.up("tenant_demo")).toHaveLength(1);
    expect(migration.up("tenant_test")).toHaveLength(1);
    expect(migration.up("tenant_under_score")).toHaveLength(1);
  });

  it.each([
    "public_valid-slug",
    "tenant_",
    'tenant_valid"quote',
    "tenant_valid$domain_compat$",
    "tenant_valid$domain_compat_atomic_0$",
    "tenant_valid slug",
    "tenant_valid\nslug",
    `tenant_${"a".repeat(57)}`,
  ])("rejects invalid tenant schema name %s before building migration SQL", (schema) => {
    expect(() => migration.up(schema)).toThrow();
    expect(() => migration.down!(schema)).toThrow();
  });
});
