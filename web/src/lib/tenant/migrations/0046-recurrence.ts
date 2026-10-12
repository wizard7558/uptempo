import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0046 (Phase 2): recurring bookings.
 *
 * - recurrence_rules: one row per repeating series (every week or every 2 weeks).
 *   A nightly job books the visits up to 84 days ahead and records how far it got
 *   in `materialized_through`.
 * - appointments.recurrence_rule_id / recurrence_index link each visit to its
 *   series. The partial unique index means a visit is never booked twice.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 46,
  description: "Recurring bookings",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".recurrence_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        rrule text NOT NULL,
        starts_at timestamptz NOT NULL,
        until timestamptz,
        count integer,
        timezone text NOT NULL,
        materialized_through timestamptz,
        staff_id uuid NOT NULL REFERENCES "${s}".staff(id) ON DELETE CASCADE,
        client_id uuid NOT NULL REFERENCES "${s}".clients(id) ON DELETE CASCADE,
        location_id uuid REFERENCES "${s}".locations(id) ON DELETE SET NULL,
        service_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        is_active integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT recurrence_rules_rrule_check CHECK (rrule IN ('FREQ=WEEKLY;INTERVAL=1','FREQ=WEEKLY;INTERVAL=2')),
        CONSTRAINT recurrence_rules_count_check CHECK (count IS NULL OR count BETWEEN 2 AND 104),
        CONSTRAINT recurrence_rules_services_check CHECK (jsonb_typeof(service_ids) = 'array' AND jsonb_array_length(service_ids) > 0),
        CONSTRAINT recurrence_rules_active_check CHECK (is_active IN (0,1))
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS recurrence_rules_due_idx ON "${s}".recurrence_rules (materialized_through) WHERE is_active = 1`,
    ),
    sql.raw(`
      ALTER TABLE "${s}".appointments
        ADD COLUMN IF NOT EXISTS recurrence_rule_id uuid REFERENCES "${s}".recurrence_rules(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS recurrence_index integer
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS appointments_recurrence_unique ON "${s}".appointments (recurrence_rule_id, recurrence_index) WHERE recurrence_rule_id IS NOT NULL`,
    ),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`DROP INDEX IF EXISTS "${s}".appointments_recurrence_unique`),
    sql.raw(
      `ALTER TABLE "${s}".appointments DROP COLUMN IF EXISTS recurrence_index, DROP COLUMN IF EXISTS recurrence_rule_id`,
    ),
    sql.raw(`DROP TABLE IF EXISTS "${s}".recurrence_rules`),
  ],
};
