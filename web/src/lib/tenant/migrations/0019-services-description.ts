import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/** Migration 0019: Optional long-form service description for booking UI. */
export const migration: TenantMigration = {
  version: 19,
  description: "services.description text column",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."services"
        ADD COLUMN IF NOT EXISTS "description" text
    `),
  ],
};
