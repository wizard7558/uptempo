import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0025: native push notifications (APNs).
 *
 * Adds a `device_tokens` table (polymorphic owner: booking client or
 * owner/staff user) and `push_reminder_sent_at`/`push_reminder_sent_at_2`
 * dedupe columns on appointments, mirroring the existing email/SMS reminder
 * columns. Enables the send-push-reminders cron to deliver appointment
 * reminders to registered iOS devices.
 */
export const migration: TenantMigration = {
  version: 25,
  description: "device_tokens table + appointments push reminder columns",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."device_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "owner_type" text NOT NULL,
        "owner_id" text NOT NULL,
        "apns_token" text NOT NULL,
        "environment" text DEFAULT 'production' NOT NULL,
        "revoked" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS "device_tokens_apns_token_unique"
        ON "${schemaName}"."device_tokens" USING btree ("apns_token")
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS "device_tokens_owner_idx"
        ON "${schemaName}"."device_tokens" USING btree ("owner_type", "owner_id")
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."appointments"
        ADD COLUMN IF NOT EXISTS "push_reminder_sent_at" timestamp with time zone
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."appointments"
        ADD COLUMN IF NOT EXISTS "push_reminder_sent_at_2" timestamp with time zone
    `),
  ],
};
