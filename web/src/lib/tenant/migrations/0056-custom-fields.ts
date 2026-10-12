import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Literal option list for the seeded client field. Kept in this file so the
 * copied hair-profile labels cannot drift from the migration.
 */
export const HAIR_OPTIONS_0064 =
  '[{"value":"all","label":"All"},{"value":"blonde","label":"Blonde"},{"value":"brunette","label":"Brunette"},{"value":"red","label":"Red"},{"value":"color-treated","label":"Color Treated"},{"value":"extensions","label":"Extensions"},{"value":"curly","label":"Curly"},{"value":"fine","label":"Fine"},{"value":"damaged","label":"Damaged"}]';

/**
 * Migration 0056 (plan 0064): custom field definitions, attribute bags, and
 * product tags. `hair_types` stays so the previous release can still read it.
 */
export const migration: TenantMigration = {
  version: 56,
  description: "Custom fields, attribute bags, and product tags",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".custom_field_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity text NOT NULL,
        key text NOT NULL,
        label text NOT NULL,
        type text NOT NULL,
        options jsonb NOT NULL DEFAULT '[]'::jsonb,
        sort integer NOT NULL DEFAULT 0,
        is_active integer NOT NULL DEFAULT 1,
        is_default integer NOT NULL DEFAULT 0,
        show_on_card integer NOT NULL DEFAULT 1,
        client_editable integer NOT NULL DEFAULT 0,
        match_product_tags integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT custom_field_definitions_entity_key_unique UNIQUE (entity, key),
        CONSTRAINT cfd_entity_check CHECK (entity IN ('client','appointment','project','request')),
        CONSTRAINT cfd_key_check CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
        CONSTRAINT cfd_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
        CONSTRAINT cfd_type_check CHECK (type IN ('text','select','multi','date','number','boolean')),
        CONSTRAINT cfd_options_check CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) <= 50),
        CONSTRAINT cfd_flags_check CHECK (is_active IN (0,1) AND is_default IN (0,1) AND show_on_card IN (0,1) AND client_editable IN (0,1) AND match_product_tags IN (0,1)),
        CONSTRAINT cfd_match_check CHECK (match_product_tags = 0 OR (entity = 'client' AND type IN ('select','multi'))),
        CONSTRAINT cfd_client_editable_check CHECK (client_editable = 0 OR entity = 'client')
      )
    `),
    sql.raw(
      `ALTER TABLE "${s}".clients ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT clients_attributes_object_check CHECK (jsonb_typeof(attributes) = 'object')`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".appointments ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT appointments_attributes_object_check CHECK (jsonb_typeof(attributes) = 'object')`,
    ),
    sql.raw(
      `ALTER TABLE IF EXISTS "${s}".booking_requests ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT booking_requests_attributes_object_check CHECK (jsonb_typeof(attributes) = 'object')`,
    ),
    sql.raw(
      `ALTER TABLE IF EXISTS "${s}".projects ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT projects_attributes_object_check CHECK (jsonb_typeof(attributes) = 'object')`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS clients_attributes_gin ON "${s}".clients USING gin (attributes jsonb_path_ops)`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".products ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT products_tags_array_check CHECK (jsonb_typeof(tags) = 'array')`,
    ),
    sql.raw(
      `UPDATE "${s}".products SET tags = hair_types WHERE hair_types <> '[]'::jsonb AND tags = '[]'::jsonb`,
    ),
    sql.raw(`
      INSERT INTO "${s}".custom_field_definitions (entity, key, label, type, options, sort, is_default, show_on_card, client_editable, match_product_tags)
      SELECT 'client', 'hair_types', 'Hair profile', 'multi', '${HAIR_OPTIONS_0064}'::jsonb, 10, 1, 1, 1, 1
      WHERE EXISTS (SELECT 1 FROM "${s}".clients WHERE hair_types <> '[]'::jsonb)
         OR EXISTS (SELECT 1 FROM "${s}".products WHERE hair_types <> '[]'::jsonb)
      ON CONFLICT (entity, key) DO NOTHING
    `),
    sql.raw(
      `UPDATE "${s}".clients SET attributes = jsonb_set(attributes, '{hair_types}', hair_types, true) WHERE hair_types <> '[]'::jsonb AND NOT (attributes ? 'hair_types')`,
    ),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`DROP INDEX IF EXISTS "${s}".clients_attributes_gin`),
    sql.raw(`ALTER TABLE "${s}".products DROP COLUMN IF EXISTS tags`),
    sql.raw(`ALTER TABLE IF EXISTS "${s}".projects DROP COLUMN IF EXISTS attributes`),
    sql.raw(`ALTER TABLE IF EXISTS "${s}".booking_requests DROP COLUMN IF EXISTS attributes`),
    sql.raw(`ALTER TABLE "${s}".appointments DROP COLUMN IF EXISTS attributes`),
    sql.raw(`ALTER TABLE "${s}".clients DROP COLUMN IF EXISTS attributes`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".custom_field_definitions`),
  ],
};
