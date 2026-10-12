import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0022: contact phone number on stylists.
 *
 * Owners want to keep a stylist's contact number alongside name + email
 * (used in profile UI; not surfaced to clients). Nullable text — existing
 * rows backfill to NULL.
 */
export const migration: TenantMigration = {
  version: 22,
  description: "stylists.phone column",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylists"
        ADD COLUMN IF NOT EXISTS "phone" text
    `),
  ],
};
