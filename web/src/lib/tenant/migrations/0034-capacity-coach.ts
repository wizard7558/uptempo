import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Capacity Coach: per-stylist goals on `stylists`, and a generic in-app
 * `alerts` table (initially populated by the Capacity Coach evaluator).
 */
export const migration: TenantMigration = {
  version: 34,
  description:
    "Capacity Coach: stylists.target_hours_per_week + target_hourly_earnings_cents; new alerts table",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".stylists ADD COLUMN IF NOT EXISTS target_hours_per_week integer`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".stylists ADD COLUMN IF NOT EXISTS target_hourly_earnings_cents integer`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".alerts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        type text NOT NULL,
        severity text NOT NULL DEFAULT 'info',
        title text NOT NULL,
        body text NOT NULL,
        data jsonb,
        dedupe_key text,
        read_at timestamp with time zone,
        dismissed_at timestamp with time zone,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS alerts_dedupe_key_unique ON "${schemaName}".alerts (dedupe_key)`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS alerts_active_idx ON "${schemaName}".alerts (dismissed_at, created_at)`,
    ),
  ],
};
