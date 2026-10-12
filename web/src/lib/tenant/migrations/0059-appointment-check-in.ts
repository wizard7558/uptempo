import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0059: staff check-in time on a booking.
 * The appointment status stays as it is. A timestamp is enough to show
 * "Checked in" and a second check-in can keep the first time.
 */
export const migration: TenantMigration = {
  version: 59,
  description: "Add appointments.checked_in_at",
  up: (s: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${s}".appointments ADD COLUMN IF NOT EXISTS checked_in_at timestamptz`,
    ),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`ALTER TABLE "${s}".appointments DROP COLUMN IF EXISTS checked_in_at`),
  ],
};
