import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0052 (Phase 3.5): walk-in queue.
 *
 * - queue_entries: one row per person in the walk-in line. The public status
 *   link is a 192-bit token stored only as a SHA-256 hash.
 * - A phone number can hold one active (waiting or called) place at a time.
 * - business_settings gains the queue switches: queue_open, queue_max_waiting,
 *   queue_text_on_join and queue_kiosk_token_hash.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 52,
  description: "Walk-in queue entries and queue settings",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".queue_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        location_id uuid REFERENCES "${s}".locations(id) ON DELETE SET NULL,
        client_id uuid REFERENCES "${s}".clients(id) ON DELETE SET NULL,
        name text NOT NULL,
        phone text,
        service_id uuid REFERENCES "${s}".services(id) ON DELETE SET NULL,
        preferred_staff_id uuid REFERENCES "${s}".staff(id) ON DELETE SET NULL,
        assigned_staff_id uuid REFERENCES "${s}".staff(id) ON DELETE SET NULL,
        appointment_id uuid REFERENCES "${s}".appointments(id) ON DELETE SET NULL,
        status text NOT NULL DEFAULT 'waiting',
        source text NOT NULL DEFAULT 'qr',
        quoted_wait_min integer,
        public_token_hash text NOT NULL,
        notes text,
        joined_at timestamptz NOT NULL DEFAULT now(),
        called_at timestamptz,
        started_at timestamptz,
        done_at timestamptz,
        left_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT queue_entries_status_check CHECK (status IN ('waiting','called','in_service','done','left')),
        CONSTRAINT queue_entries_source_check CHECK (source IN ('qr','kiosk','front_desk')),
        CONSTRAINT queue_entries_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
        CONSTRAINT queue_entries_quoted_check CHECK (quoted_wait_min IS NULL OR quoted_wait_min BETWEEN 0 AND 1440)
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_token_unique ON "${s}".queue_entries (public_token_hash)`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS queue_entries_active_idx ON "${s}".queue_entries (location_id, joined_at) WHERE status IN ('waiting','called','in_service')`,
    ),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS queue_entries_phone_active_unique ON "${s}".queue_entries (phone) WHERE phone IS NOT NULL AND status IN ('waiting','called')`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS queue_entries_service_done_idx ON "${s}".queue_entries (service_id, done_at) WHERE status = 'done'`,
    ),
    sql.raw(`
      ALTER TABLE "${s}".business_settings
        ADD COLUMN IF NOT EXISTS queue_open integer NOT NULL DEFAULT 0 CONSTRAINT business_settings_queue_open_check CHECK (queue_open IN (0,1)),
        ADD COLUMN IF NOT EXISTS queue_max_waiting integer NOT NULL DEFAULT 30 CONSTRAINT business_settings_queue_max_check CHECK (queue_max_waiting BETWEEN 1 AND 200),
        ADD COLUMN IF NOT EXISTS queue_text_on_join integer NOT NULL DEFAULT 0 CONSTRAINT business_settings_queue_text_join_check CHECK (queue_text_on_join IN (0,1)),
        ADD COLUMN IF NOT EXISTS queue_kiosk_token_hash text
    `),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${s}".business_settings
        DROP COLUMN IF EXISTS queue_kiosk_token_hash,
        DROP COLUMN IF EXISTS queue_text_on_join,
        DROP COLUMN IF EXISTS queue_max_waiting,
        DROP COLUMN IF EXISTS queue_open
    `),
    sql.raw(`DROP TABLE IF EXISTS "${s}".queue_entries`),
  ],
};
