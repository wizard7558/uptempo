import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0011: Link flex (double-book) appointments to the host appointment
 * whose processing window they occupy — enables triple-book prevention and schedule UX.
 */
export const migration: TenantMigration = {
  version: 11,
  description: "Add double_book_parent_appointment_id to appointments",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}".appointments
        ADD COLUMN IF NOT EXISTS double_book_parent_appointment_id uuid
        REFERENCES "${schemaName}".appointments(id)
        ON DELETE SET NULL
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS appointments_double_book_parent_idx
        ON "${schemaName}".appointments (double_book_parent_appointment_id)
        WHERE double_book_parent_appointment_id IS NOT NULL
    `),
  ],
};
