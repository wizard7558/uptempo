import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0012: Optional per-service cost (cents) for margin / COGS estimates on analytics.
 */
export const migration: TenantMigration = {
  version: 12,
  description: "Add services.cost_cents for estimated COGS",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}".services
        ADD COLUMN IF NOT EXISTS cost_cents integer
    `),
  ],
};
