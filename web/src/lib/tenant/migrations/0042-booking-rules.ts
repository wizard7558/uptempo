import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0042 (Phase 2): booking rules on business_settings.
 * The column defaults (same-day on, 2 hours' notice) apply to rows created
 * later. Rows that already exist are set to same_day_booking = 0 so every live
 * business keeps the old "earliest online booking is tomorrow" rule until the
 * owner turns same-day on under Settings -> Booking Rules.
 */
export const migration: TenantMigration = {
  version: 42,
  description: "Add booking rules to business_settings; existing rows keep no same-day booking",
  up: (s: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${s}"."business_settings"
        ADD COLUMN IF NOT EXISTS "min_notice_minutes" integer NOT NULL DEFAULT 120
          CONSTRAINT "business_settings_min_notice_check" CHECK ("min_notice_minutes" BETWEEN 0 AND 20160),
        ADD COLUMN IF NOT EXISTS "max_advance_days" integer NOT NULL DEFAULT 28
          CONSTRAINT "business_settings_max_advance_check" CHECK ("max_advance_days" BETWEEN 1 AND 730),
        ADD COLUMN IF NOT EXISTS "slot_interval_minutes" integer NOT NULL DEFAULT 15
          CONSTRAINT "business_settings_slot_interval_check" CHECK ("slot_interval_minutes" IN (5,10,15,20,30,60)),
        ADD COLUMN IF NOT EXISTS "same_day_booking" integer NOT NULL DEFAULT 1
          CONSTRAINT "business_settings_same_day_check" CHECK ("same_day_booking" IN (0,1))
    `),
    sql.raw(`UPDATE "${s}"."business_settings" SET "same_day_booking" = 0`),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${s}"."business_settings"
        DROP COLUMN IF EXISTS "same_day_booking",
        DROP COLUMN IF EXISTS "slot_interval_minutes",
        DROP COLUMN IF EXISTS "max_advance_days",
        DROP COLUMN IF EXISTS "min_notice_minutes"
    `),
  ],
};
