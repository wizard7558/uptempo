import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0026: Soft-delete support for clients.
 *
 * Adds a nullable `deleted_at` column so clients can be archived (hidden from the
 * list) without destroying their linked history (appointments, charges, texts,
 * forms, signatures — none of which cascade from clients).
 *
 * The unique email/phone indexes are recreated so they only apply to non-deleted
 * rows, letting a salon re-add a client with the same phone/email after archiving
 * the old record.
 */
export const migration: TenantMigration = {
  version: 26,
  description:
    "Add deleted_at to clients and scope unique email/phone indexes to non-deleted rows",
  up: (schemaName: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${schemaName}".clients ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
    ),
    sql.raw(`DROP INDEX IF EXISTS "${schemaName}".clients_email_unique`),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS clients_email_unique ON "${schemaName}".clients (email) WHERE email IS NOT NULL AND deleted_at IS NULL`,
    ),
    sql.raw(`DROP INDEX IF EXISTS "${schemaName}".clients_phone_unique`),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS clients_phone_unique ON "${schemaName}".clients (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL`,
    ),
  ],
};
