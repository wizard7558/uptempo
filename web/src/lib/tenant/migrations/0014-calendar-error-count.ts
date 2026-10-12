import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0014: Track consecutive OAuth refresh failures before marking connection error.
 */
export const migration: TenantMigration = {
  version: 14,
  description:
    "calendar_connections.error_count for Google token refresh retry tolerance",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."calendar_connections"
        ADD COLUMN IF NOT EXISTS "error_count" integer NOT NULL DEFAULT 0
    `),
  ],
};
