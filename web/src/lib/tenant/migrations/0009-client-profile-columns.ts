import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0009: Backfill client profile columns for legacy tenant schemas.
 *
 * Some older tenant schemas were provisioned before expanded client profile
 * fields were added. This migration ensures list/edit client flows can safely
 * select all expected columns.
 */
export const migration: TenantMigration = {
  version: 9,
  description: "Backfill client profile columns for legacy tenant schemas",
  up: (schemaName: string): SQL[] => [
    // One statement per column — easier to debug across Postgres versions and
    // avoids a single multi-ADD statement failing entirely if one clause misbehaves.
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS birthday date`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS gender text`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS address text`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS city text`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS state text`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS zip text`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS customer_since date`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS appointments_booked integer`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS source text`,
    ),
    sql.raw(`
      ALTER TABLE "${schemaName}".clients
        ALTER COLUMN appointments_booked SET DEFAULT 0
    `),
    sql.raw(`
      UPDATE "${schemaName}".clients
      SET appointments_booked = 0
      WHERE appointments_booked IS NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".clients
        ALTER COLUMN appointments_booked SET NOT NULL
    `),
  ],
};
