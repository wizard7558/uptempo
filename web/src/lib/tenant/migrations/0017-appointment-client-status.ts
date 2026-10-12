import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0017: Snapshot new vs repeat at booking time for analytics.
 */
export const migration: TenantMigration = {
  version: 17,
  description: "appointments.client_status_at_booking (new | repeat)",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."appointments"
        ADD COLUMN IF NOT EXISTS "client_status_at_booking" text
    `),
  ],
};
