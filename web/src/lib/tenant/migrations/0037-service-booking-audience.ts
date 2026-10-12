import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Per-service online booking audience:
 *   'all'       — anyone can self-book (default; existing behavior)
 *   'new'       — only first-time clients (0 appointments booked)
 *   'returning' — only returning clients
 * Lets a salon restrict new clients to e.g. a Consultation while returning
 * clients see the full menu. Staff booking is never restricted.
 */
export const migration: TenantMigration = {
  version: 37,
  description: "services.booking_audience ('all'|'new'|'returning')",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".services ADD COLUMN IF NOT EXISTS booking_audience text NOT NULL DEFAULT 'all'`,
    ),
  ],
};
