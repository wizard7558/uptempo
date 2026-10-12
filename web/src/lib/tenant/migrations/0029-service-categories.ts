import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0029: custom, salon-defined service categories.
 *
 * Creates the `service_categories` table and seeds the built-in defaults (matching
 * the previously-hardcoded list). `services.category` continues to store the
 * category slug, so existing rows keep working; salons can now add their own
 * categories (e.g. "maintenance") that show up on both the stylist and client side.
 */
export const migration: TenantMigration = {
  version: 29,
  description: "Add service_categories table and seed default categories",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."service_categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "slug" text NOT NULL,
        "name" text NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "is_default" integer DEFAULT 0 NOT NULL,
        "is_active" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "service_categories_slug_unique" ON "${schemaName}"."service_categories" USING btree ("slug")`,
    ),
    sql.raw(`
      INSERT INTO "${schemaName}"."service_categories" ("slug", "name", "sort_order", "is_default")
      VALUES
        ('cut', 'Cut', 10, 1),
        ('color', 'Color', 20, 1),
        ('extensions', 'Extensions', 30, 1),
        ('style', 'Style', 40, 1),
        ('treatment', 'Treatment', 50, 1),
        ('addon', 'Add-on', 60, 1),
        ('other', 'Other', 100, 1)
      ON CONFLICT ("slug") DO NOTHING
    `),
  ],
};
