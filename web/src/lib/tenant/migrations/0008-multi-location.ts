import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0008: Add multi-location support for working hours, appointments,
 * and public booking availability.
 */
export const migration: TenantMigration = {
  version: 8,
  description: "Add locations and location-aware scheduling",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".locations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        address text,
        is_active integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `),
    sql.raw(`
      INSERT INTO "${schemaName}".locations (name, address)
      SELECT 'Primary Location', salon_address
      FROM "${schemaName}".salon_policies
      WHERE NOT EXISTS (
        SELECT 1 FROM "${schemaName}".locations
      )
      LIMIT 1
    `),
    sql.raw(`
      INSERT INTO "${schemaName}".locations (name, address)
      SELECT 'Primary Location', NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM "${schemaName}".locations
      )
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".working_hours
        ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES "${schemaName}".locations(id)
    `),
    sql.raw(`
      UPDATE "${schemaName}".working_hours
      SET location_id = (
        SELECT id
        FROM "${schemaName}".locations
        ORDER BY created_at ASC
        LIMIT 1
      )
      WHERE location_id IS NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".appointments
        ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES "${schemaName}".locations(id)
    `),
    sql.raw(`
      UPDATE "${schemaName}".appointments
      SET location_id = (
        SELECT id
        FROM "${schemaName}".locations
        ORDER BY created_at ASC
        LIMIT 1
      )
      WHERE location_id IS NULL
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS working_hours_location_idx
        ON "${schemaName}".working_hours (location_id)
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS appointments_location_idx
        ON "${schemaName}".appointments (location_id)
    `),
  ],
};
