import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0047 (Phase 3.1): requests and quotes.
 *
 * - booking_requests: a client's "I want this" request for businesses that quote first.
 * - attachments: private files (reference photos, ID documents). Storage keys only; no URLs.
 * - quotes / quote_line_items: the owner's priced offer. One "sent" quote per request.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 47,
  description: "Booking requests, quotes, attachments",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".booking_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES "${s}".clients(id) ON DELETE CASCADE,
        service_id uuid REFERENCES "${s}".services(id) ON DELETE SET NULL,
        staff_id uuid REFERENCES "${s}".staff(id) ON DELETE SET NULL,
        kind text NOT NULL DEFAULT 'quote',
        status text NOT NULL DEFAULT 'new',
        answers jsonb NOT NULL DEFAULT '{}'::jsonb,
        preferred_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
        appointment_id uuid REFERENCES "${s}".appointments(id) ON DELETE SET NULL,
        decline_reason text,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT booking_requests_kind_check CHECK (kind IN ('quote','consultation','custom_piece')),
        CONSTRAINT booking_requests_status_check CHECK (status IN ('new','reviewing','quoted','accepted','declined','converted','expired')),
        CONSTRAINT booking_requests_answers_check CHECK (jsonb_typeof(answers) = 'object'),
        CONSTRAINT booking_requests_windows_check CHECK (jsonb_typeof(preferred_windows) = 'array')
      )
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS booking_requests_status_created_idx ON "${s}".booking_requests (status, created_at DESC)
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS booking_requests_client_idx ON "${s}".booking_requests (client_id)
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_type text NOT NULL,
        owner_id uuid,
        client_id uuid REFERENCES "${s}".clients(id) ON DELETE CASCADE,
        kind text NOT NULL,
        storage_key text NOT NULL,
        mime text NOT NULL,
        size_bytes integer NOT NULL,
        original_name text,
        is_private integer NOT NULL DEFAULT 1,
        uploaded_by text NOT NULL,
        delete_after timestamptz,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT attachments_owner_type_check CHECK (owner_type IN ('request','appointment','project','form_response','client')),
        CONSTRAINT attachments_kind_check CHECK (kind IN ('reference','before','after','site','id_document','design')),
        CONSTRAINT attachments_private_check CHECK (is_private IN (0,1) AND (kind <> 'id_document' OR is_private = 1)),
        CONSTRAINT attachments_size_check CHECK (size_bytes > 0 AND size_bytes <= 10485760),
        CONSTRAINT attachments_mime_check CHECK (mime IN ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf')),
        CONSTRAINT attachments_storage_key_unique UNIQUE (storage_key)
      )
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS attachments_owner_idx ON "${s}".attachments (owner_type, owner_id) WHERE deleted_at IS NULL
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS attachments_delete_after_idx ON "${s}".attachments (delete_after) WHERE delete_after IS NOT NULL AND deleted_at IS NULL
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".quotes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NOT NULL REFERENCES "${s}".booking_requests(id) ON DELETE CASCADE,
        staff_id uuid REFERENCES "${s}".staff(id) ON DELETE SET NULL,
        status text NOT NULL DEFAULT 'draft',
        access_token text NOT NULL,
        subtotal_cents integer NOT NULL DEFAULT 0,
        deposit_cents integer NOT NULL DEFAULT 0,
        message text,
        valid_until timestamptz,
        sent_at timestamptz,
        accepted_at timestamptz,
        accepted_name text,
        accepted_ip text,
        declined_at timestamptz,
        appointment_id uuid REFERENCES "${s}".appointments(id) ON DELETE SET NULL,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT quotes_status_check CHECK (status IN ('draft','sent','accepted','declined','expired','withdrawn')),
        CONSTRAINT quotes_amounts_check CHECK (subtotal_cents >= 0 AND deposit_cents >= 0 AND deposit_cents <= subtotal_cents),
        CONSTRAINT quotes_sent_fields_check CHECK (status = 'draft' OR (sent_at IS NOT NULL AND valid_until IS NOT NULL)),
        CONSTRAINT quotes_accepted_fields_check CHECK (status <> 'accepted' OR (accepted_at IS NOT NULL AND accepted_name IS NOT NULL)),
        CONSTRAINT quotes_access_token_unique UNIQUE (access_token)
      )
    `),
    sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_sent_per_request ON "${s}".quotes (request_id) WHERE status = 'sent'
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS quotes_request_idx ON "${s}".quotes (request_id)
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".quote_line_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id uuid NOT NULL REFERENCES "${s}".quotes(id) ON DELETE CASCADE,
        service_id uuid NOT NULL REFERENCES "${s}".services(id) ON DELETE RESTRICT,
        description text NOT NULL,
        quantity integer NOT NULL DEFAULT 1,
        unit_cents integer NOT NULL,
        minutes integer NOT NULL DEFAULT 0,
        sort integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT quote_line_items_quantity_check CHECK (quantity BETWEEN 1 AND 100),
        CONSTRAINT quote_line_items_unit_check CHECK (unit_cents BETWEEN 0 AND 10000000),
        CONSTRAINT quote_line_items_minutes_check CHECK (minutes BETWEEN 0 AND 1440)
      )
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS quote_line_items_quote_idx ON "${s}".quote_line_items (quote_id, sort)
    `),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`DROP TABLE IF EXISTS "${s}".quote_line_items`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".quotes`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".attachments`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".booking_requests`),
  ],
};
