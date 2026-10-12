import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0039: restore appointments_double_book_idx.
 *
 * Migration 0005 defined this partial index, but tenants provisioned from the
 * hand-written baseline (which skips 0002-0006) never received it. The
 * definition is copied verbatim from 0005; IF NOT EXISTS makes it a no-op for
 * tenants that already have it.
 */
export const migration: TenantMigration = {
  version: 39,
  description: "Recreate appointments_double_book_idx missing on baseline tenants",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      CREATE INDEX IF NOT EXISTS appointments_double_book_idx
        ON "${schemaName}".appointments (stylist_id, is_double_book)
        WHERE (status != 'cancelled')
    `),
  ],
};
