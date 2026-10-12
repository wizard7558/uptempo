import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  migration,
  TABLE_RENAMES_0040,
  COLUMN_RENAMES_0040,
  INDEX_RENAMES_0040,
  CONSTRAINT_RENAMES_0040,
} from "./0040-domain-renames";

const dialect = new PgDialect();
const S = "tenant_t";
const text = (stmts: SQL[]) => stmts.map((s) => dialect.sqlToQuery(s).sql);

const up = text(migration.up(S));
const down = text(migration.down!(S));

describe("migration 0040 (no DB)", () => {
  it("is version 40 and defines down", () => {
    expect(migration.version).toBe(40);
    expect(typeof migration.down).toBe("function");
  });

  it("up and down have the same number of statements", () => {
    expect(down.length).toBe(up.length);
  });

  it("every RENAME TO in up has its inverse in down", () => {
    const re = /ALTER (?:TABLE|INDEX)(?: IF EXISTS)? "tenant_t"\."([^"]+)" RENAME TO "([^"]+)"/;
    const renames = up.map((s) => s.match(re)).filter(Boolean) as RegExpMatchArray[];
    expect(renames.length).toBe(
      TABLE_RENAMES_0040.length + INDEX_RENAMES_0040.length,
    );
    for (const [, from, to] of renames) {
      // Tables are renamed back using the new table name as the qualifier.
      expect(down.some((s) => s.includes(`"${to}" RENAME TO "${from}"`))).toBe(true);
    }
  });

  it("every RENAME COLUMN in up has its inverse in down", () => {
    const re = /ALTER TABLE "tenant_t"\."([^"]+)" RENAME COLUMN "([^"]+)" TO "([^"]+)"/;
    const renames = up.map((s) => s.match(re)).filter(Boolean) as RegExpMatchArray[];
    expect(renames.length).toBe(COLUMN_RENAMES_0040.length);
    for (const [, table, from, to] of renames) {
      expect(
        down.some((s) => s.includes(`"${table}" RENAME COLUMN "${to}" TO "${from}"`)),
      ).toBe(true);
    }
  });

  it("constraint renames are applied in up and reversed in down", () => {
    const upCon = up.find((s) => s.includes("RENAME CONSTRAINT"))!;
    const downCon = down.find((s) => s.includes("RENAME CONSTRAINT"))!;
    for (const [t, o, n] of CONSTRAINT_RENAMES_0040) {
      expect(upCon).toContain(`('${t}', '${o}', '${n}')`);
      expect(downCon).toContain(`('${t}', '${n}', '${o}')`);
    }
  });

  it("role value and default flip and revert", () => {
    expect(up.some((s) => s.includes(`SET "role" = 'provider' WHERE "role" = 'stylist'`))).toBe(true);
    expect(up.some((s) => s.includes(`SET DEFAULT 'provider'`))).toBe(true);
    expect(down.some((s) => s.includes(`SET "role" = 'stylist' WHERE "role" = 'provider'`))).toBe(true);
    expect(down.some((s) => s.includes(`SET DEFAULT 'stylist'`))).toBe(true);
  });

  it("covers every legacy name from the inventory", () => {
    const joined = up.join("\n");
    const legacy = [
      "stylists", "stylist_services", "salon_policies", "beauty_bank_transactions", "beauty_bank_balances",
      "stylist_id", "salon_address", "beauty_bank_expiry_months", "beauty_bank_cents",
      "appointments_stylist_status_idx", "calendar_connections_stylist_id_idx",
      "calendar_connections_stylist_platform_idx", "external_events_stylist_time_idx",
      "time_blocks_stylist_during_idx", "stylist_services_stylist_offered_idx",
      "beauty_bank_transactions_client_created_idx",
      "stylists_pkey", "stylists_default_assistant_id_fkey", "stylist_services_pkey",
      "stylist_service_unique", "stylist_services_stylist_id_fkey", "stylist_services_service_id_fkey",
      "working_hours_stylist_day_unique", "working_hours_stylist_id_fkey",
      "calendar_connections_stylist_id_fkey", "time_blocks_stylist_id_fkey", "salon_policies_pkey",
      "beauty_bank_transactions_pkey", "beauty_bank_transactions_client_id_fkey",
      "beauty_bank_transactions_counterparty_client_id_fkey", "beauty_bank_balances_pkey",
      "beauty_bank_balances_client_id_fkey",
    ];
    for (const name of legacy) expect(joined).toContain(name);
  });

  it("rename lists have no duplicates", () => {
    const dupes = (xs: readonly string[]) => new Set(xs).size === xs.length;
    expect(dupes(TABLE_RENAMES_0040.map(([o]) => o))).toBe(true);
    expect(dupes(TABLE_RENAMES_0040.map(([, n]) => n))).toBe(true);
    expect(dupes(COLUMN_RENAMES_0040.map(([t, o]) => `${t}.${o}`))).toBe(true);
    expect(dupes(INDEX_RENAMES_0040.map(([o]) => o))).toBe(true);
    expect(dupes(INDEX_RENAMES_0040.map(([, n]) => n))).toBe(true);
    expect(dupes(CONSTRAINT_RENAMES_0040.map(([t, o]) => `${t}.${o}`))).toBe(true);
    expect(dupes(CONSTRAINT_RENAMES_0040.map(([t, , n]) => `${t}.${n}`))).toBe(true);
  });
});
