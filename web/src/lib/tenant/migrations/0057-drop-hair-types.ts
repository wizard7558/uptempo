import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Known hair-profile tags. Rollback copies only these values back onto the
 * old columns, in alphabetical order so the restored arrays are stable.
 */
export const HAIR_VALUES_0065 =
  "'all','blonde','brunette','red','color-treated','extensions','curly','fine','damaged'";

/**
 * Migration 0057 (plan 0065): hair profile data lives on client attributes and
 * product tags. Re-sync any rows written during the previous release, then
 * drop `hair_types`. The copy is dynamic SQL so a retry after the drop is a no-op.
 */
export const migration: TenantMigration = {
  version: 57,
  description: "Drop hair_types after copying values into attributes and tags",
  up: (s: string): SQL[] => [
    sql.raw(`
      DO $do$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = '${s}' AND table_name = 'clients' AND column_name = 'hair_types'
        ) THEN
          EXECUTE $sql$
            UPDATE "${s}".clients
            SET attributes = jsonb_set(attributes, '{hair_types}', hair_types, true)
            WHERE hair_types <> '[]'::jsonb AND NOT (attributes ? 'hair_types')
          $sql$;
        END IF;
      END $do$
    `),
    sql.raw(`
      DO $do$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = '${s}' AND table_name = 'products' AND column_name = 'hair_types'
        ) THEN
          EXECUTE $sql$
            UPDATE "${s}".products
            SET tags = hair_types
            WHERE hair_types <> '[]'::jsonb AND tags = '[]'::jsonb
          $sql$;
        END IF;
      END $do$
    `),
    sql.raw(`ALTER TABLE "${s}".clients DROP COLUMN IF EXISTS hair_types`),
    sql.raw(`ALTER TABLE "${s}".products DROP COLUMN IF EXISTS hair_types`),
  ],
  down: (s: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${s}".clients ADD COLUMN IF NOT EXISTS hair_types jsonb NOT NULL DEFAULT '[]'::jsonb`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".products ADD COLUMN IF NOT EXISTS hair_types jsonb NOT NULL DEFAULT '[]'::jsonb`,
    ),
    sql.raw(`
      UPDATE "${s}".clients
      SET hair_types = (
        SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb)
        FROM jsonb_array_elements_text(attributes->'hair_types') v
        WHERE v IN (${HAIR_VALUES_0065})
      )
      WHERE jsonb_typeof(attributes->'hair_types') = 'array'
    `),
    sql.raw(`
      UPDATE "${s}".products
      SET hair_types = (
        SELECT COALESCE(jsonb_agg(v ORDER BY v), '[]'::jsonb)
        FROM jsonb_array_elements_text(tags) v
        WHERE v IN (${HAIR_VALUES_0065})
      )
      WHERE tags <> '[]'::jsonb
    `),
  ],
};
