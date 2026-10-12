import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0021: per-stylist service overrides.
 *
 * Extends `stylist_services` (a pure join until now) with optional fields that
 * let each stylist override the salon catalog defaults: price, duration,
 * processing-time split, a custom display name, and a soft "offered" flag
 * for hiding a catalog service without unlinking. NULL on any override means
 * "use the catalog default." `is_offered` defaults to 1 so existing rows are
 * unchanged behaviorally.
 */
export const migration: TenantMigration = {
  version: 21,
  description:
    "stylist_services per-stylist override columns (price, duration, processing split, custom name, is_offered, updated_at)",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylist_services"
        ADD COLUMN IF NOT EXISTS "price_cents" integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylist_services"
        ADD COLUMN IF NOT EXISTS "duration_minutes" integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylist_services"
        ADD COLUMN IF NOT EXISTS "active_minutes" integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylist_services"
        ADD COLUMN IF NOT EXISTS "processing_minutes" integer
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylist_services"
        ADD COLUMN IF NOT EXISTS "custom_name" text
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylist_services"
        ADD COLUMN IF NOT EXISTS "is_offered" integer DEFAULT 1 NOT NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylist_services"
        ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS "stylist_services_stylist_offered_idx"
        ON "${schemaName}"."stylist_services" ("stylist_id", "is_offered")
    `),
  ],
};
