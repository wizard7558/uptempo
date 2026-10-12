import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0053 (Phase 3.5): slot waitlist.
 *
 * - waitlist_openings: one row per cancelled appointment that can be offered.
 * - slot_waitlist: a client's request. An `offered` row is the hold.
 * - business_settings.waitlist_hold_minutes: how long that hold lasts.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 53,
  description: "Slot waitlist, openings, and hold minutes",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".waitlist_openings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        appointment_id uuid REFERENCES "${s}".appointments(id) ON DELETE SET NULL,
        staff_id uuid NOT NULL REFERENCES "${s}".staff(id) ON DELETE CASCADE,
        location_id uuid REFERENCES "${s}".locations(id) ON DELETE SET NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        status text NOT NULL DEFAULT 'open',
        attempts integer NOT NULL DEFAULT 0,
        offered_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT waitlist_openings_status_check CHECK (status IN ('open','offered','filled','closed')),
        CONSTRAINT waitlist_openings_range_check CHECK (ends_at > starts_at),
        CONSTRAINT waitlist_openings_attempts_check CHECK (attempts BETWEEN 0 AND 3),
        CONSTRAINT waitlist_openings_offered_check CHECK (jsonb_typeof(offered_entry_ids) = 'array')
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS waitlist_openings_appointment_unique ON "${s}".waitlist_openings (appointment_id) WHERE appointment_id IS NOT NULL`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS waitlist_openings_open_idx ON "${s}".waitlist_openings (starts_at) WHERE status = 'open'`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".slot_waitlist (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES "${s}".clients(id) ON DELETE CASCADE,
        service_ids jsonb NOT NULL,
        staff_id uuid REFERENCES "${s}".staff(id) ON DELETE CASCADE,
        location_id uuid REFERENCES "${s}".locations(id) ON DELETE SET NULL,
        date_from date NOT NULL,
        date_to date NOT NULL,
        time_from text NOT NULL DEFAULT '00:00',
        time_to text NOT NULL DEFAULT '23:59',
        status text NOT NULL DEFAULT 'waiting',
        source text NOT NULL DEFAULT 'online',
        notified_at timestamptz,
        missed_offers integer NOT NULL DEFAULT 0,
        opening_id uuid REFERENCES "${s}".waitlist_openings(id) ON DELETE SET NULL,
        offer_token_hash text,
        offer_expires_at timestamptz,
        offered_staff_id uuid REFERENCES "${s}".staff(id) ON DELETE SET NULL,
        offered_start timestamptz,
        offered_end timestamptz,
        offered_location_id uuid REFERENCES "${s}".locations(id) ON DELETE SET NULL,
        booked_appointment_id uuid REFERENCES "${s}".appointments(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT slot_waitlist_status_check CHECK (status IN ('waiting','offered','booked','expired','cancelled')),
        CONSTRAINT slot_waitlist_source_check CHECK (source IN ('online','front_desk')),
        CONSTRAINT slot_waitlist_services_check CHECK (jsonb_typeof(service_ids) = 'array' AND jsonb_array_length(service_ids) BETWEEN 1 AND 5),
        CONSTRAINT slot_waitlist_dates_check CHECK (date_to >= date_from AND date_to - date_from <= 60),
        CONSTRAINT slot_waitlist_times_check CHECK (time_from ~ '^[0-2][0-9]:[0-5][0-9]$' AND time_to ~ '^[0-2][0-9]:[0-5][0-9]$' AND time_from < time_to),
        CONSTRAINT slot_waitlist_offer_check CHECK (status <> 'offered' OR (offer_token_hash IS NOT NULL AND offer_expires_at IS NOT NULL AND offered_staff_id IS NOT NULL AND offered_start IS NOT NULL AND offered_end IS NOT NULL))
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS slot_waitlist_match_idx ON "${s}".slot_waitlist (date_from, date_to) WHERE status = 'waiting'`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS slot_waitlist_client_idx ON "${s}".slot_waitlist (client_id) WHERE status IN ('waiting','offered')`,
    ),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS slot_waitlist_offer_token_unique ON "${s}".slot_waitlist (offer_token_hash) WHERE offer_token_hash IS NOT NULL`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS slot_waitlist_holds_idx ON "${s}".slot_waitlist (offered_staff_id, offer_expires_at) WHERE status = 'offered'`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".business_settings ADD COLUMN IF NOT EXISTS waitlist_hold_minutes integer NOT NULL DEFAULT 15 CONSTRAINT business_settings_waitlist_hold_check CHECK (waitlist_hold_minutes BETWEEN 5 AND 120)`,
    ),
  ],
  down: (s: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${s}".business_settings DROP COLUMN IF EXISTS waitlist_hold_minutes`,
    ),
    sql.raw(`DROP TABLE IF EXISTS "${s}".slot_waitlist`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".waitlist_openings`),
  ],
};
