import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0030: linked service add-ons.
 *
 * `service_addons` maps optional add-on services to a primary service so the
 * booking page can offer them together (e.g. "1 row of weft install" offered with
 * "partial color"). Add-ons are themselves normal services, so a selected add-on
 * becomes an ordinary appointment line item.
 */
export const migration: TenantMigration = {
  version: 30,
  description: "Add service_addons table linking add-on services to a primary",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."service_addons" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "primary_service_id" uuid NOT NULL REFERENCES "${schemaName}"."services"("id") ON DELETE CASCADE,
        "addon_service_id" uuid NOT NULL REFERENCES "${schemaName}"."services"("id") ON DELETE CASCADE,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "service_addon_unique" UNIQUE("primary_service_id", "addon_service_id")
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "service_addons_primary_idx" ON "${schemaName}"."service_addons" USING btree ("primary_service_id")`,
    ),
  ],
};
