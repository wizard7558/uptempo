import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0040 (Phase 1.4): strip salon-specific names from the tenant schema.
 * Pure renames plus staff.role 'stylist' -> 'provider'. Postgres stores index keys,
 * predicates, exclusion constraints (appointments_no_overlap, time_blocks_no_overlap)
 * and FKs by attnum/OID, so RENAME updates them. Optional objects a legacy tenant may
 * lack are renamed only when present. Fully reversible via `down`.
 */
export const TABLE_RENAMES_0040 = [
  ["stylists", "staff"],
  ["stylist_services", "staff_services"],
  ["salon_policies", "business_settings"],
  ["beauty_bank_transactions", "stored_value_transactions"],
  ["beauty_bank_balances", "stored_value_balances"],
] as const;

/** [table name AFTER the table renames, old column, new column] */
export const COLUMN_RENAMES_0040 = [
  ["staff_services", "stylist_id", "staff_id"],
  ["appointments", "stylist_id", "staff_id"],
  ["working_hours", "stylist_id", "staff_id"],
  ["calendar_connections", "stylist_id", "staff_id"],
  ["external_events", "stylist_id", "staff_id"],
  ["time_blocks", "stylist_id", "staff_id"],
  ["business_settings", "salon_address", "business_address"],
  ["business_settings", "beauty_bank_expiry_months", "stored_value_expiry_months"],
  ["charges", "beauty_bank_cents", "stored_value_cents"],
] as const;

/** Standalone (non-constraint) indexes, old -> new. */
export const INDEX_RENAMES_0040 = [
  ["appointments_stylist_status_idx", "appointments_staff_status_idx"],
  ["calendar_connections_stylist_id_idx", "calendar_connections_staff_id_idx"],
  ["calendar_connections_stylist_platform_idx", "calendar_connections_staff_platform_idx"],
  ["external_events_stylist_time_idx", "external_events_staff_time_idx"],
  ["time_blocks_stylist_during_idx", "time_blocks_staff_during_idx"],
  ["stylist_services_stylist_offered_idx", "staff_services_staff_offered_idx"],
  ["beauty_bank_transactions_client_created_idx", "stored_value_transactions_client_created_idx"],
] as const;

/** [table name AFTER renames, old constraint, new constraint]. PK/UNIQUE renames carry their index. */
export const CONSTRAINT_RENAMES_0040 = [
  ["staff", "stylists_pkey", "staff_pkey"],
  ["staff", "stylists_default_assistant_id_fkey", "staff_default_assistant_id_fkey"],
  ["staff_services", "stylist_services_pkey", "staff_services_pkey"],
  ["staff_services", "stylist_service_unique", "staff_service_unique"],
  ["staff_services", "stylist_services_stylist_id_fkey", "staff_services_staff_id_fkey"],
  ["staff_services", "stylist_services_service_id_fkey", "staff_services_service_id_fkey"],
  ["working_hours", "working_hours_stylist_day_unique", "working_hours_staff_day_unique"],
  ["working_hours", "working_hours_stylist_id_fkey", "working_hours_staff_id_fkey"],
  ["calendar_connections", "calendar_connections_stylist_id_fkey", "calendar_connections_staff_id_fkey"],
  ["time_blocks", "time_blocks_stylist_id_fkey", "time_blocks_staff_id_fkey"],
  ["business_settings", "salon_policies_pkey", "business_settings_pkey"],
  ["stored_value_transactions", "beauty_bank_transactions_pkey", "stored_value_transactions_pkey"],
  ["stored_value_transactions", "beauty_bank_transactions_client_id_fkey", "stored_value_transactions_client_id_fkey"],
  ["stored_value_transactions", "beauty_bank_transactions_counterparty_client_id_fkey", "stored_value_transactions_counterparty_client_id_fkey"],
  ["stored_value_balances", "beauty_bank_balances_pkey", "stored_value_balances_pkey"],
  ["stored_value_balances", "beauty_bank_balances_client_id_fkey", "stored_value_balances_client_id_fkey"],
] as const;

const SHARED = ["appointments", "working_hours", "calendar_connections", "external_events", "time_blocks", "charges"];
const AFFECTED_NEW = [...TABLE_RENAMES_0040.map(([, n]) => n), ...SHARED];
const AFFECTED_OLD = [...TABLE_RENAMES_0040.map(([o]) => o), ...SHARED];

function renameConstraints(s: string, rows: ReadonlyArray<readonly [string, string, string]>): SQL {
  const values = rows.map(([t, o, n]) => `('${t}', '${o}', '${n}')`).join(",\n      ");
  return sql.raw(`
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ${values}
    ) AS v(tbl, old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = '${s}' AND t.relname = r.tbl AND c.conname = r.old_name
    ) THEN
      EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I', '${s}', r.tbl, r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$`);
}

/** PG 18+: reset NOT NULL constraint names to the default derived from current names. No-op on PG <= 17. */
function normalizeNotNull(s: string, tables: readonly string[]): SQL {
  const list = tables.map((t) => `'${t}'`).join(", ");
  return sql.raw(`
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT t.relname AS tbl, c.conname, t.relname || '_' || a.attname || '_not_null' AS want
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
    WHERE n.nspname = '${s}' AND c.contype = 'n' AND t.relname IN (${list})
      AND c.conname <> t.relname || '_' || a.attname || '_not_null'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I', '${s}', r.tbl, r.conname, r.want);
  END LOOP;
END $$`);
}

export const migration: TenantMigration = {
  version: 40,
  description:
    "Domain renames: stylists->staff, stylist_services->staff_services, salon_policies->business_settings, beauty_bank_*->stored_value_*, stylist_id->staff_id; staff.role 'stylist'->'provider'",
  up: (s: string): SQL[] => [
    ...TABLE_RENAMES_0040.map(([o, n]) => sql.raw(`ALTER TABLE "${s}"."${o}" RENAME TO "${n}"`)),
    ...COLUMN_RENAMES_0040.map(([t, o, n]) => sql.raw(`ALTER TABLE "${s}"."${t}" RENAME COLUMN "${o}" TO "${n}"`)),
    ...INDEX_RENAMES_0040.map(([o, n]) => sql.raw(`ALTER INDEX IF EXISTS "${s}"."${o}" RENAME TO "${n}"`)),
    renameConstraints(s, CONSTRAINT_RENAMES_0040),
    normalizeNotNull(s, AFFECTED_NEW),
    sql.raw(`UPDATE "${s}"."staff" SET "role" = 'provider' WHERE "role" = 'stylist'`),
    sql.raw(`ALTER TABLE "${s}"."staff" ALTER COLUMN "role" SET DEFAULT 'provider'`),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`ALTER TABLE "${s}"."staff" ALTER COLUMN "role" SET DEFAULT 'stylist'`),
    sql.raw(`UPDATE "${s}"."staff" SET "role" = 'stylist' WHERE "role" = 'provider'`),
    renameConstraints(s, CONSTRAINT_RENAMES_0040.map(([t, o, n]) => [t, n, o] as const)),
    ...INDEX_RENAMES_0040.map(([o, n]) => sql.raw(`ALTER INDEX IF EXISTS "${s}"."${n}" RENAME TO "${o}"`)),
    ...[...COLUMN_RENAMES_0040].reverse().map(([t, o, n]) => sql.raw(`ALTER TABLE "${s}"."${t}" RENAME COLUMN "${n}" TO "${o}"`)),
    ...[...TABLE_RENAMES_0040].reverse().map(([o, n]) => sql.raw(`ALTER TABLE "${s}"."${n}" RENAME TO "${o}"`)),
    normalizeNotNull(s, AFFECTED_OLD),
  ],
};
