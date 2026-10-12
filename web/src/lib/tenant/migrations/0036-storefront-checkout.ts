import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Storefront phase 2 (client-facing checkout): orders table, client hair-profile
 * tags for recommendations, and per-salon retail tax/shipping settings.
 */
export const migration: TenantMigration = {
  version: 36,
  description:
    "Storefront checkout: orders table; clients.hair_types; salon_policies.retail_tax_bps + retail_ship_flat_cents",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS hair_types jsonb NOT NULL DEFAULT '[]'::jsonb`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS retail_tax_bps integer NOT NULL DEFAULT 0`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS retail_ship_flat_cents integer`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        stripe_checkout_session_id text NOT NULL,
        stripe_payment_intent_id text,
        client_id uuid,
        customer_name text,
        customer_email text,
        items jsonb NOT NULL DEFAULT '[]'::jsonb,
        subtotal_cents integer NOT NULL,
        tax_cents integer NOT NULL DEFAULT 0,
        shipping_cents integer NOT NULL DEFAULT 0,
        total_cents integer NOT NULL,
        platform_fee_cents integer NOT NULL DEFAULT 0,
        fulfillment text NOT NULL DEFAULT 'pickup',
        shipping_address jsonb,
        status text NOT NULL DEFAULT 'paid',
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_session_unique ON "${schemaName}".orders (stripe_checkout_session_id)`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS orders_status_created_idx ON "${schemaName}".orders (status, created_at)`,
    ),
  ],
};
