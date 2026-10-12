import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0058: booking-page theme columns.
 * A business still on the old default green keeps crimson. Any other
 * primary_color is copied once, while brand_color is still the column default,
 * so a retry does not overwrite a color saved after the first run.
 * primary_color, accent_color, and font_preference stay until release cutover.
 */
export const migration: TenantMigration = {
  version: 58,
  description: "Add booking-page theme columns to branding_settings",
  up: (s: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${s}".branding_settings ADD COLUMN IF NOT EXISTS brand_color text NOT NULL DEFAULT '#B3122E'`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".branding_settings ADD COLUMN IF NOT EXISTS font_pairing text NOT NULL DEFAULT 'score' CONSTRAINT branding_settings_font_pairing_check CHECK (font_pairing IN ('score','sans'))`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".branding_settings ADD COLUMN IF NOT EXISTS corner_style text NOT NULL DEFAULT 'soft' CONSTRAINT branding_settings_corner_style_check CHECK (corner_style IN ('square','soft','round'))`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".branding_settings ADD COLUMN IF NOT EXISTS density text NOT NULL DEFAULT 'comfortable' CONSTRAINT branding_settings_density_check CHECK (density IN ('comfortable','compact'))`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".branding_settings ADD COLUMN IF NOT EXISTS color_mode text NOT NULL DEFAULT 'light' CONSTRAINT branding_settings_color_mode_check CHECK (color_mode IN ('light','dark'))`,
    ),
    sql.raw(`
      UPDATE "${s}".branding_settings
      SET brand_color = primary_color
      WHERE primary_color IS NOT NULL
        AND lower(btrim(primary_color)) <> '#6b8f3c'
        AND brand_color = '#B3122E'
    `),
    sql.raw(`
      UPDATE "${s}".branding_settings
      SET font_pairing = 'sans'
      WHERE font_preference = 'sans-serif'
        AND font_pairing = 'score'
    `),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`ALTER TABLE "${s}".branding_settings DROP COLUMN IF EXISTS color_mode`),
    sql.raw(`ALTER TABLE "${s}".branding_settings DROP COLUMN IF EXISTS density`),
    sql.raw(`ALTER TABLE "${s}".branding_settings DROP COLUMN IF EXISTS corner_style`),
    sql.raw(`ALTER TABLE "${s}".branding_settings DROP COLUMN IF EXISTS font_pairing`),
    sql.raw(`ALTER TABLE "${s}".branding_settings DROP COLUMN IF EXISTS brand_color`),
  ],
};
