import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0002: Add payment method toggle columns to salon_policies.
 * Each column is an integer toggle (0=disabled, 1=enabled) defaulting to enabled.
 * These toggles control which alternative payment methods appear in the
 * client checkout UI via Stripe PaymentIntent configuration.
 */
export const migration: TenantMigration = {
  version: 2,
  description: "Add payment method toggle columns to salon_policies",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}".salon_policies
        ADD COLUMN IF NOT EXISTS apple_pay_enabled integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS google_pay_enabled integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS afterpay_enabled integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS cashapp_enabled integer NOT NULL DEFAULT 1
    `),
  ],
};
