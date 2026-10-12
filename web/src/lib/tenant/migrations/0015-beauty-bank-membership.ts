import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0015: Beauty Bank membership plans, client memberships, ledger, balances.
 */
export const migration: TenantMigration = {
  version: 15,
  description:
    "membership_plans, client_memberships, beauty_bank_transactions, beauty_bank_balances; charges.beauty_bank_cents",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      CREATE TABLE "${schemaName}"."membership_plans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "monthly_amount_cents" integer NOT NULL,
        "retail_discount_percent" integer NOT NULL DEFAULT 0,
        "priority_booking" integer NOT NULL DEFAULT 0,
        "priority_booking_days" integer NOT NULL DEFAULT 14,
        "stripe_price_id" text,
        "stripe_product_id" text,
        "description" text,
        "is_active" integer NOT NULL DEFAULT 1,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(`
      CREATE TABLE "${schemaName}"."client_memberships" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "client_id" uuid NOT NULL REFERENCES "${schemaName}"."clients"("id") ON DELETE CASCADE,
        "plan_id" uuid NOT NULL REFERENCES "${schemaName}"."membership_plans"("id"),
        "stripe_subscription_id" text,
        "stripe_customer_id" text,
        "status" text NOT NULL DEFAULT 'active',
        "current_period_start" timestamp with time zone,
        "current_period_end" timestamp with time zone,
        "cancelled_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(`
      CREATE UNIQUE INDEX "client_memberships_one_active"
        ON "${schemaName}"."client_memberships" ("client_id")
        WHERE "status" = 'active'
    `),
    sql.raw(`
      CREATE INDEX "client_memberships_stripe_sub_idx"
        ON "${schemaName}"."client_memberships" ("stripe_subscription_id")
        WHERE "stripe_subscription_id" IS NOT NULL
    `),
    sql.raw(`
      CREATE TABLE "${schemaName}"."beauty_bank_transactions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "client_id" uuid NOT NULL REFERENCES "${schemaName}"."clients"("id") ON DELETE CASCADE,
        "type" text NOT NULL,
        "amount_cents" integer NOT NULL,
        "running_balance_cents" integer NOT NULL,
        "reference_id" text,
        "counterparty_client_id" uuid REFERENCES "${schemaName}"."clients"("id") ON DELETE SET NULL,
        "note" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_by" text
      )
    `),
    sql.raw(`
      CREATE INDEX "beauty_bank_transactions_client_created_idx"
        ON "${schemaName}"."beauty_bank_transactions" ("client_id", "created_at" DESC)
    `),
    sql.raw(`
      CREATE TABLE "${schemaName}"."beauty_bank_balances" (
        "client_id" uuid PRIMARY KEY REFERENCES "${schemaName}"."clients"("id") ON DELETE CASCADE,
        "balance_cents" integer NOT NULL DEFAULT 0,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."charges"
        ADD COLUMN IF NOT EXISTS "beauty_bank_cents" integer
    `),
  ],
};
