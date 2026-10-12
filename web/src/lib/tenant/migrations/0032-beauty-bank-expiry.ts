import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0032: optional Beauty Bank credit expiry.
 *
 * `beauty_bank_expiry_months` on salon_policies: when set, credits expire that
 * many months after they're earned (FIFO). NULL (the default) = never expire, so
 * the feature is inert until a salon opts in.
 */
export const migration: TenantMigration = {
  version: 32,
  description: "Add beauty_bank_expiry_months to salon_policies",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS beauty_bank_expiry_months integer`,
    ),
  ],
};
