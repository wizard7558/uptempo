import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0003: Add SMS consent tracking, message log, and reminder columns.
 * Creates sms_consent and sms_messages tables, adds sms_reminder_sent_at to
 * appointments, and adds SMS configuration columns to salon_policies.
 */
export const migration: TenantMigration = {
  version: 3,
  description:
    "Add SMS consent tracking, message log, and reminder columns",
  up: (schemaName: string): SQL[] => [
    // 1. sms_consent table — TCPA audit trail (append-only semantics)
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".sms_consent (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES "${schemaName}".clients(id) ON DELETE CASCADE,
        phone text NOT NULL,
        consented_at timestamptz,
        opted_out_at timestamptz,
        consent_method text NOT NULL,
        consent_source text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS sms_consent_phone_idx ON "${schemaName}".sms_consent(phone)`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS sms_consent_client_id_idx ON "${schemaName}".sms_consent(client_id)`,
    ),

    // 2. sms_messages table — delivery tracking log
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".sms_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        appointment_id uuid REFERENCES "${schemaName}".appointments(id),
        client_id uuid REFERENCES "${schemaName}".clients(id),
        to_phone text NOT NULL,
        body text NOT NULL,
        message_sid text,
        status text NOT NULL DEFAULT 'queued',
        error_code text,
        error_message text,
        message_type text NOT NULL DEFAULT 'reminder',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_sid_idx ON "${schemaName}".sms_messages(message_sid) WHERE message_sid IS NOT NULL`,
    ),

    // 3. Add sms_reminder_sent_at to appointments (independent from email reminderSentAt)
    sql.raw(`
      ALTER TABLE "${schemaName}".appointments
        ADD COLUMN IF NOT EXISTS sms_reminder_sent_at timestamptz
    `),

    // 4. Add SMS configuration columns to salon_policies
    sql.raw(`
      ALTER TABLE "${schemaName}".salon_policies
        ADD COLUMN IF NOT EXISTS sms_reminders_enabled integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS sms_reminder_hours_before integer NOT NULL DEFAULT 24,
        ADD COLUMN IF NOT EXISTS sms_reminder_body text
    `),
  ],
};
