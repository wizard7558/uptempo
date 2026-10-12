import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0031: configurable booking deposits.
 *
 * Two layers, resolved per service (override beats the global rule):
 *  - Salon global rule on `salon_policies`: when enabled, services at/above an
 *    optional duration threshold require `deposit_default_type`/`deposit_default_amount`.
 *  - Per-service override on `services`: `deposit_type` ('none'|'percent'|'fixed')
 *    with `deposit_amount`; NULL inherits the global rule.
 *
 * `appointments.deposit_cents` records what was actually collected so it can be
 * credited against the final bill at checkout. Deposit charges live in `charges`
 * with reason = 'deposit' (no schema change — `reason` is free text).
 */
export const migration: TenantMigration = {
  version: 31,
  description: "Add deposit configuration to services, salon_policies, appointments",
  up: (schemaName: string): SQL[] => [
    // Per-service override
    sql.raw(
      `ALTER TABLE "${schemaName}".services ADD COLUMN IF NOT EXISTS deposit_type text`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".services ADD COLUMN IF NOT EXISTS deposit_amount integer`,
    ),
    // Salon global rule
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS deposit_enabled integer NOT NULL DEFAULT 0`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS deposit_default_type text NOT NULL DEFAULT 'percent'`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS deposit_default_amount integer NOT NULL DEFAULT 0`,
    ),
    sql.raw(
      `ALTER TABLE "${schemaName}".salon_policies ADD COLUMN IF NOT EXISTS deposit_duration_threshold_minutes integer`,
    ),
    // Collected deposit recorded on the appointment
    sql.raw(
      `ALTER TABLE "${schemaName}".appointments ADD COLUMN IF NOT EXISTS deposit_cents integer NOT NULL DEFAULT 0`,
    ),
  ],
};
