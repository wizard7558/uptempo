import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/** Retail storefront: products the salon sells. */
export const migration: TenantMigration = {
  version: 35,
  description: "Retail storefront: products table",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".products (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        name text NOT NULL,
        brand text,
        description text,
        size text,
        price_cents integer NOT NULL,
        cost_cents integer,
        photo_url text,
        hair_types jsonb NOT NULL DEFAULT '[]'::jsonb,
        is_active integer NOT NULL DEFAULT 1,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamp with time zone DEFAULT now() NOT NULL,
        updated_at timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS products_active_sort_idx ON "${schemaName}".products (is_active, sort_order)`,
    ),
  ],
};
