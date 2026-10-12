import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0043 (Phase 2): split shifts, date overrides, service timing.
 *
 * - working_hours loses its (staff_id, day_of_week) unique constraint so a day
 *   can hold several shifts. The constraint is named working_hours_stylist_day_unique
 *   on tenants that have not run 0040 yet and working_hours_staff_day_unique after,
 *   so both names are dropped.
 * - availability_overrides replaces the weekly hours for one staff member on one date
 *   (an empty interval list means closed).
 * - services gains buffers, per-service booking rules, a location type and a
 *   "version of" link.
 *
 * Every statement is safe to run again.
 *
 * The down is lossy: split shifts collapse to one row per staff and day (the
 * first enabled shift, by start time).
 */
export const migration: TenantMigration = {
  version: 43,
  description: "Split shifts, date overrides, and service timing fields",
  up: (s: string): SQL[] => [
    sql.raw(`ALTER TABLE "${s}"."working_hours" DROP CONSTRAINT IF EXISTS "working_hours_staff_day_unique"`),
    sql.raw(`ALTER TABLE "${s}"."working_hours" DROP CONSTRAINT IF EXISTS "working_hours_stylist_day_unique"`),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "working_hours_staff_day_idx" ON "${s}"."working_hours" ("staff_id", "day_of_week")`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}"."availability_overrides" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "staff_id" uuid NOT NULL REFERENCES "${s}"."staff"("id") ON DELETE CASCADE,
        "date" date NOT NULL,
        "intervals" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "availability_overrides_staff_date_unique" UNIQUE ("staff_id", "date"),
        CONSTRAINT "availability_overrides_intervals_array_check" CHECK (jsonb_typeof("intervals") = 'array')
      )
    `),
    sql.raw(`
      ALTER TABLE "${s}"."services"
        ADD COLUMN IF NOT EXISTS "buffer_before_min" integer NOT NULL DEFAULT 0
          CONSTRAINT "services_buffer_before_check" CHECK ("buffer_before_min" BETWEEN 0 AND 240),
        ADD COLUMN IF NOT EXISTS "buffer_after_min" integer NOT NULL DEFAULT 0
          CONSTRAINT "services_buffer_after_check" CHECK ("buffer_after_min" BETWEEN 0 AND 240),
        ADD COLUMN IF NOT EXISTS "min_notice_min" integer
          CONSTRAINT "services_min_notice_check" CHECK ("min_notice_min" IS NULL OR "min_notice_min" BETWEEN 0 AND 20160),
        ADD COLUMN IF NOT EXISTS "max_advance_days" integer
          CONSTRAINT "services_max_advance_check" CHECK ("max_advance_days" IS NULL OR "max_advance_days" BETWEEN 1 AND 730),
        ADD COLUMN IF NOT EXISTS "slot_interval_min" integer
          CONSTRAINT "services_slot_interval_check" CHECK ("slot_interval_min" IS NULL OR "slot_interval_min" IN (5,10,15,20,30,60)),
        ADD COLUMN IF NOT EXISTS "location_type" text NOT NULL DEFAULT 'in_studio'
          CONSTRAINT "services_location_type_check" CHECK ("location_type" IN ('in_studio','on_site','virtual')),
        ADD COLUMN IF NOT EXISTS "variant_of_service_id" uuid REFERENCES "${s}"."services"("id") ON DELETE SET NULL
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS "services_variant_of_idx" ON "${s}"."services" ("variant_of_service_id") WHERE "variant_of_service_id" IS NOT NULL`,
    ),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`DROP INDEX IF EXISTS "${s}"."services_variant_of_idx"`),
    sql.raw(`
      ALTER TABLE "${s}"."services"
        DROP COLUMN IF EXISTS "variant_of_service_id",
        DROP COLUMN IF EXISTS "location_type",
        DROP COLUMN IF EXISTS "slot_interval_min",
        DROP COLUMN IF EXISTS "max_advance_days",
        DROP COLUMN IF EXISTS "min_notice_min",
        DROP COLUMN IF EXISTS "buffer_after_min",
        DROP COLUMN IF EXISTS "buffer_before_min"
    `),
    sql.raw(`DROP TABLE IF EXISTS "${s}"."availability_overrides"`),
    sql.raw(`
      DELETE FROM "${s}"."working_hours" w WHERE EXISTS (
        SELECT 1 FROM "${s}"."working_hours" k
        WHERE k.staff_id = w.staff_id AND k.day_of_week = w.day_of_week
          AND (-k.is_enabled, k.start_time, k.id) < (-w.is_enabled, w.start_time, w.id))
    `),
    sql.raw(`DROP INDEX IF EXISTS "${s}"."working_hours_staff_day_idx"`),
    sql.raw(
      `ALTER TABLE "${s}"."working_hours" ADD CONSTRAINT "working_hours_staff_day_unique" UNIQUE ("staff_id", "day_of_week")`,
    ),
  ],
};
