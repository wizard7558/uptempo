import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0055: per-service checklists and a caption on private photos.
 *
 * `attachments.uploaded_by` and `attachments.size_bytes` already exist from
 * 0047, and the kind check already allows before, after, site, id_document,
 * and design. This down therefore drops only the caption. Replacing the
 * existing 10 MB size check would reject the 0047 constraint test.
 */
export const migration: TenantMigration = {
  version: 55,
  description: "Checklists and photo captions",
  up: (s: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${s}".attachments
        ADD COLUMN IF NOT EXISTS uploaded_by text,
        ADD COLUMN IF NOT EXISTS size_bytes integer,
        ADD COLUMN IF NOT EXISTS caption text CONSTRAINT attachments_caption_check CHECK (caption IS NULL OR char_length(caption) <= 200)
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS attachments_owner_created_idx ON "${s}".attachments (owner_type, owner_id, created_at)`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".checklist_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        service_id uuid NOT NULL REFERENCES "${s}".services(id) ON DELETE CASCADE,
        items jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT checklist_templates_service_unique UNIQUE (service_id),
        CONSTRAINT checklist_templates_items_check CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 30)
      )
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".appointment_checklist_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        appointment_id uuid NOT NULL REFERENCES "${s}".appointments(id) ON DELETE CASCADE,
        label text NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        source_key text,
        done_at timestamptz,
        done_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT appointment_checklist_items_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
        CONSTRAINT appointment_checklist_items_done_check CHECK ((done_at IS NULL) = (done_by IS NULL))
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS appointment_checklist_items_source_unique ON "${s}".appointment_checklist_items (appointment_id, source_key) WHERE source_key IS NOT NULL`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS appointment_checklist_items_appt_idx ON "${s}".appointment_checklist_items (appointment_id, sort_order)`,
    ),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`DROP TABLE IF EXISTS "${s}".appointment_checklist_items`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".checklist_templates`),
    sql.raw(`DROP INDEX IF EXISTS "${s}".attachments_owner_created_idx`),
    sql.raw(`ALTER TABLE "${s}".attachments DROP COLUMN IF EXISTS caption`),
  ],
};
