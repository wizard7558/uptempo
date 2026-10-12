import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0007: Add service categories, price overrides, appointment snapshots,
 * and expense tracking for the beta analytics workflow.
 */
export const migration: TenantMigration = {
  version: 7,
  description:
    "Add service categories, price overrides, appointment snapshots, and expenses",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}".services
        ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other'
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".client_service_overrides
        ADD COLUMN IF NOT EXISTS price_cents integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".client_service_overrides
        ALTER COLUMN duration_minutes DROP NOT NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}".appointment_services
        ADD COLUMN IF NOT EXISTS active_minutes integer,
        ADD COLUMN IF NOT EXISTS processing_minutes integer
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".expenses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        expense_date date NOT NULL,
        vendor_name text NOT NULL,
        category text NOT NULL,
        amount_cents integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS expenses_expense_date_idx
        ON "${schemaName}".expenses (expense_date)
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS expenses_category_idx
        ON "${schemaName}".expenses (category)
    `),
  ],
};
