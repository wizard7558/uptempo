import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0005: Add smart scheduling columns to services, overrides, and appointments.
 * Enables active/processing time breakdown for services, double-book flag for appointments,
 * and refines the exclusion constraint to allow overlapping when is_double_book = 1.
 */
export const migration: TenantMigration = {
  version: 5,
  description:
    "Add smart scheduling columns to services, overrides, and appointments",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}".services
        ADD COLUMN IF NOT EXISTS active_minutes integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".services
        ADD COLUMN IF NOT EXISTS processing_minutes integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".client_service_overrides
        ADD COLUMN IF NOT EXISTS active_minutes integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".client_service_overrides
        ADD COLUMN IF NOT EXISTS processing_minutes integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".appointments
        ADD COLUMN IF NOT EXISTS is_double_book integer NOT NULL DEFAULT 0
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".appointments
        DROP CONSTRAINT IF EXISTS appointments_no_overlap
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".appointments
        ADD CONSTRAINT appointments_no_overlap
        EXCLUDE USING gist (
          stylist_id WITH =,
          during WITH &&
        )
        WHERE (status != 'cancelled' AND is_double_book = 0)
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS appointments_double_book_idx
        ON "${schemaName}".appointments (stylist_id, is_double_book)
        WHERE (status != 'cancelled')
    `),
  ],
};
