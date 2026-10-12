import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0020: SMS confirmation/aftercare/form toggles, second reminder windows,
 * and per-appointment second-reminder sent timestamps.
 */
export const migration: TenantMigration = {
  version: 20,
  description:
    "salon_policies SMS toggles + second reminder hours; appointments second reminder sent columns",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."salon_policies"
        ADD COLUMN IF NOT EXISTS "sms_confirmation_enabled" integer DEFAULT 0 NOT NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."salon_policies"
        ADD COLUMN IF NOT EXISTS "sms_confirmation_body" text
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."salon_policies"
        ADD COLUMN IF NOT EXISTS "sms_aftercare_enabled" integer DEFAULT 0 NOT NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."salon_policies"
        ADD COLUMN IF NOT EXISTS "sms_form_requests_enabled" integer DEFAULT 0 NOT NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."salon_policies"
        ADD COLUMN IF NOT EXISTS "reminder_hours_before_2" integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."salon_policies"
        ADD COLUMN IF NOT EXISTS "sms_reminder_hours_before_2" integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."appointments"
        ADD COLUMN IF NOT EXISTS "reminder_sent_at_2" timestamp with time zone
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."appointments"
        ADD COLUMN IF NOT EXISTS "sms_reminder_sent_at_2" timestamp with time zone
    `),
  ],
};
