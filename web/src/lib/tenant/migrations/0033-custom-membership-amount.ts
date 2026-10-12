import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0033: custom Beauty Bank contribution amounts.
 *
 * - `membership_plans.allow_custom_amount`: when 1, clients may choose any
 *   whole-dollar amount at or above the plan's price.
 * - `client_memberships.monthly_amount_cents`: the effective amount for this
 *   membership (NULL = fall back to the plan's amount, for back-compat).
 * - `client_memberships.stripe_price_id`: the Stripe price actually subscribed.
 *
 * All columns are nullable / defaulted, so existing rows are unaffected.
 */
export const migration: TenantMigration = {
  version: 33,
  description:
    "Custom Beauty Bank amount: client_memberships.monthly_amount_cents + stripe_price_id; membership_plans.allow_custom_amount",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".client_memberships ADD COLUMN IF NOT EXISTS monthly_amount_cents integer`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".client_memberships ADD COLUMN IF NOT EXISTS stripe_price_id text`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".membership_plans ADD COLUMN IF NOT EXISTS allow_custom_amount integer NOT NULL DEFAULT 0`,
    ),
  ],
};
