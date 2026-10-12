import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0004: Add branding_settings table for booking page customization.
 * Stores per-tenant branding configuration: colors, logo, font, and platform badge visibility.
 */
export const migration: TenantMigration = {
  version: 4,
  description:
    "Add branding_settings table for booking page customization",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".branding_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        primary_color text DEFAULT '#6b8f3c',
        accent_color text DEFAULT '#d4c9a8',
        logo_url text,
        font_preference text DEFAULT 'system',
        show_powered_by integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `),
  ],
};
