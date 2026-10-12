import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0010: Overlap prevention is per stylist + location (not per stylist alone).
 *
 * Legacy constraint treated any two non-double-book appointments for the same stylist
 * as conflicting even at different locations. Multi-location booking needs parallel
 * availability when the stylist is at distinct locations for non-overlapping business
 * rules (and after migration 0008 backfills location_id).
 *
 * NULL location_id is folded into a sentinel UUID so legacy rows still block each
 * other but do not block a different explicit location.
 */
export const migration: TenantMigration = {
  version: 10,
  description: "Scope appointment overlap exclusion to stylist + location",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}".appointments
        DROP CONSTRAINT IF EXISTS appointments_no_overlap
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".appointments
        ADD CONSTRAINT appointments_no_overlap
        EXCLUDE USING gist (
          stylist_id WITH =,
          (COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
          during WITH &&
        )
        WHERE (status <> 'cancelled' AND is_double_book = 0)
    `),
  ],
};
