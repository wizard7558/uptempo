import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0024: salon-policies prose + signed acknowledgements with card-on-file.
 *
 * Adds an editable `policy_text` column to `salon_policies` so the salon owner
 * can author the policies their clients sign before an appointment, and a
 * `policy_signatures` table that records each signed acknowledgement plus the
 * Stripe payment method captured during the same flow. SMS toggle for
 * intake-request links mirrors the existing `sms_form_requests_enabled` flag.
 */
export const migration: TenantMigration = {
  version: 24,
  description:
    "salon_policies.policy_text + sms_intake_requests_enabled, policy_signatures table",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."salon_policies"
        ADD COLUMN IF NOT EXISTS "policy_text" text
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."salon_policies"
        ADD COLUMN IF NOT EXISTS "sms_intake_requests_enabled" integer DEFAULT 0 NOT NULL
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."policy_signatures" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL REFERENCES "${schemaName}"."clients"("id"),
        "appointment_id" uuid REFERENCES "${schemaName}"."appointments"("id"),
        "policy_text" text NOT NULL,
        "signed_name" text,
        "signed_at" timestamptz,
        "payment_method_id" text,
        "ip_address" text,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL
      )
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS "policy_signatures_client_id_idx"
        ON "${schemaName}"."policy_signatures" ("client_id")
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS "policy_signatures_appointment_id_idx"
        ON "${schemaName}"."policy_signatures" ("appointment_id")
    `),
  ],
};
