import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Labels for the 9 expense category slugs the app stored before per-tenant
 * categories existed. Kept as a literal so this migration never drifts if the
 * hair pack changes later.
 */
export const LEGACY_EXPENSE_LABELS_0041: ReadonlyArray<readonly [string, string]> = [
  ["color", "Color"],
  ["extensions", "Extensions"],
  ["backbar", "Backbar"],
  ["retail", "Retail"],
  ["tools_supplies", "Tools & Supplies"],
  ["rent", "Rent"],
  ["utilities", "Utilities"],
  ["subscriptions", "Subscriptions"],
  ["other", "Other"],
];

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * Migration 0041 (Phase 1.9): per-tenant expense categories.
 * `expenses.category` keeps storing the slug (no foreign key), so every stored
 * value stays valid. Only categories already used by expenses are backfilled
 * (is_default = 0); the industry pack's defaults are seeded lazily by the app.
 * `down` drops the table; expenses rows are untouched.
 */
export const migration: TenantMigration = {
  version: 41,
  description: "Add expense_categories; backfill categories used by expenses",
  up: (s: string): SQL[] => {
    const cases = LEGACY_EXPENSE_LABELS_0041.map(
      ([slug, label]) => `WHEN ${lit(slug)} THEN ${lit(label)}`,
    ).join(" ");
    return [
      sql.raw(
        `CREATE TABLE IF NOT EXISTS "${s}"."expense_categories" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "slug" text NOT NULL, "name" text NOT NULL, "sort_order" integer DEFAULT 0 NOT NULL, "is_default" integer DEFAULT 0 NOT NULL, "is_active" integer DEFAULT 1 NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL)`,
      ),
      sql.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_slug_unique" ON "${s}"."expense_categories" USING btree ("slug")`,
      ),
      sql.raw(
        `INSERT INTO "${s}"."expense_categories" ("slug","name","sort_order","is_default") SELECT e.category, CASE e.category ${cases} ELSE initcap(replace(e.category,'_',' ')) END, 1000, 0 FROM (SELECT DISTINCT category FROM "${s}"."expenses" WHERE btrim(category) <> '') e ON CONFLICT ("slug") DO NOTHING`,
      ),
    ];
  },
  down: (s: string): SQL[] => [
    sql.raw(`DROP TABLE IF EXISTS "${s}"."expense_categories"`),
  ],
};
