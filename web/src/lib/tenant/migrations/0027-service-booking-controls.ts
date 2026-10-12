import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0027: per-service booking controls.
 *
 * - `online_bookable`: 0 makes a service internal-only — staff can still book it,
 *   but it's hidden from the public booking page (e.g. consultations are bookable
 *   online while keratin extensions are booked by the stylist).
 * - `price_display`: how the price renders to clients — exact ('show'),
 *   "From $X" ('starting'), or hidden ('hidden').
 */
export const migration: TenantMigration = {
  version: 27,
  description: "Add online_bookable and price_display to services",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".services ADD COLUMN IF NOT EXISTS online_bookable integer NOT NULL DEFAULT 1`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".services ADD COLUMN IF NOT EXISTS price_display text NOT NULL DEFAULT 'show'`,
    ),
  ],
};
