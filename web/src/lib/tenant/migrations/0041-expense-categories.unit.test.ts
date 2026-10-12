import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { migration, LEGACY_EXPENSE_LABELS_0041 } from "./0041-expense-categories";
import {
  HAIR_SALON_EXPENSE_CATEGORY_VALUES,
  hairSalon,
} from "@/lib/verticals/hair-salon";

const dialect = new PgDialect();
const text = (stmts: SQL[]) => stmts.map((s) => dialect.sqlToQuery(s).sql);

describe("migration 0041 (no DB)", () => {
  it("is version 41 and defines down", () => {
    expect(migration.version).toBe(41);
    expect(typeof migration.down).toBe("function");
  });

  it("legacy labels match the hair pack", () => {
    expect(LEGACY_EXPENSE_LABELS_0041).toEqual(
      HAIR_SALON_EXPENSE_CATEGORY_VALUES.map((v, i) => [v, hairSalon.expenseCategories[i]]),
    );
  });

  it("up creates the table in the tenant schema and carries the labels", () => {
    const up = text(migration.up("tenant_x")).join("\n");
    expect(up).toContain('"tenant_x"."expense_categories"');
    expect(up).toContain("'Tools & Supplies'");
  });

  it("down drops only expense_categories", () => {
    const down = text(migration.down!("tenant_x"));
    expect(down).toEqual(['DROP TABLE IF EXISTS "tenant_x"."expense_categories"']);
  });
});
