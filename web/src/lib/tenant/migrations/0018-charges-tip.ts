import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/** Migration 0018: Optional gratuity on service checkout charges. */
export const migration: TenantMigration = {
  version: 18,
  description: "charges.tip_cents for checkout gratuity",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."charges"
        ADD COLUMN IF NOT EXISTS "tip_cents" integer
    `),
  ],
};
