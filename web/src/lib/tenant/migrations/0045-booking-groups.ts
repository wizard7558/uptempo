import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0045 (Phase 2): group bookings.
 *
 * - booking_groups: several appointments booked together (a couple, a party, one
 *   client with several techs, a crew). `client_id` is the payer.
 * - appointments.booking_group_id and charges.booking_group_id link members and
 *   the single group charge to the group.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 45,
  description: "Group bookings",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".booking_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES "${s}".clients(id),
        kind text NOT NULL,
        deposit_cents integer NOT NULL DEFAULT 0,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT booking_groups_kind_check CHECK (kind IN ('couples','party','multi_tech','crew')),
        CONSTRAINT booking_groups_deposit_check CHECK (deposit_cents >= 0)
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS booking_groups_client_idx ON "${s}".booking_groups (client_id)`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".appointments ADD COLUMN IF NOT EXISTS booking_group_id uuid REFERENCES "${s}".booking_groups(id) ON DELETE SET NULL`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS appointments_booking_group_idx ON "${s}".appointments (booking_group_id) WHERE booking_group_id IS NOT NULL`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".charges ADD COLUMN IF NOT EXISTS booking_group_id uuid REFERENCES "${s}".booking_groups(id) ON DELETE SET NULL`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS charges_booking_group_idx ON "${s}".charges (booking_group_id) WHERE booking_group_id IS NOT NULL`,
    ),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`DROP INDEX IF EXISTS "${s}".charges_booking_group_idx`),
    sql.raw(`ALTER TABLE "${s}".charges DROP COLUMN IF EXISTS booking_group_id`),
    sql.raw(`DROP INDEX IF EXISTS "${s}".appointments_booking_group_idx`),
    sql.raw(`ALTER TABLE "${s}".appointments DROP COLUMN IF EXISTS booking_group_id`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".booking_groups`),
  ],
};
