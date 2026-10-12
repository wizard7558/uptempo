import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0051 (Phase 3.4): packages, credit ledger, membership credits.
 *
 * - packages: sellable credit packs. client_packages: a client's owned pack
 *   (or membership credit bucket).
 * - credit_ledger is the only way credits_remaining changes. A BEFORE INSERT
 *   trigger locks the package row, computes balance_after, rejects balances
 *   below 0 (23514 credit_ledger_insufficient) and updates the cached
 *   credits_remaining / credits_total. Another trigger zeroes
 *   credits_remaining on client_packages insert, and a third makes ledger
 *   rows append-only (42501).
 * - membership_plans gain kind / credits_per_period / rollover_max /
 *   eligible_service_ids.
 * - charges.appointment_id becomes nullable (pack sales have no appointment)
 *   and charges.client_package_id is added.
 * - appointments.credit_entry_id and class_enrollments.credit_entry_id
 *   (column from 0050) now reference credit_ledger.
 *
 * Every statement is safe to run again.
 *
 * The down is LOSSY by design: charges with no appointment (pack sales) are
 * deleted so appointment_id can be NOT NULL again.
 */
export const migration: TenantMigration = {
  version: 51,
  description: "Packages, credit ledger, membership credits, nullable charges",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".packages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        description text,
        price_cents integer NOT NULL,
        credits integer NOT NULL,
        valid_days integer,
        eligible_service_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        is_active integer NOT NULL DEFAULT 1,
        sort integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT packages_price_check CHECK (price_cents >= 0),
        CONSTRAINT packages_credits_check CHECK (credits BETWEEN 1 AND 500),
        CONSTRAINT packages_valid_days_check CHECK (valid_days IS NULL OR valid_days BETWEEN 1 AND 1825),
        CONSTRAINT packages_eligible_check CHECK (jsonb_typeof(eligible_service_ids) = 'array'),
        CONSTRAINT packages_active_check CHECK (is_active IN (0,1))
      )
    `),
    sql.raw(`
      ALTER TABLE "${s}".membership_plans
        ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'stored_value' CONSTRAINT membership_plans_kind_check CHECK (kind IN ('stored_value','credits','discount')),
        ADD COLUMN IF NOT EXISTS credits_per_period integer CONSTRAINT membership_plans_credits_check CHECK (credits_per_period IS NULL OR credits_per_period BETWEEN 1 AND 100),
        ADD COLUMN IF NOT EXISTS rollover_max integer NOT NULL DEFAULT 0 CONSTRAINT membership_plans_rollover_check CHECK (rollover_max BETWEEN 0 AND 100),
        ADD COLUMN IF NOT EXISTS eligible_service_ids jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT membership_plans_eligible_check CHECK (jsonb_typeof(eligible_service_ids) = 'array')
    `),
    sql.raw(`
      DO $do$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'membership_plans_credits_kind_check' AND connamespace = '"${s}"'::regnamespace) THEN
          ALTER TABLE "${s}".membership_plans ADD CONSTRAINT membership_plans_credits_kind_check CHECK (kind <> 'credits' OR credits_per_period IS NOT NULL);
        END IF;
      END $do$
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".client_packages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES "${s}".clients(id) ON DELETE CASCADE,
        package_id uuid REFERENCES "${s}".packages(id) ON DELETE SET NULL,
        client_membership_id uuid REFERENCES "${s}".client_memberships(id) ON DELETE SET NULL,
        name text NOT NULL,
        credits_total integer NOT NULL DEFAULT 0,
        credits_remaining integer NOT NULL DEFAULT 0,
        eligible_service_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        expires_at timestamptz,
        status text NOT NULL DEFAULT 'active',
        price_cents integer NOT NULL DEFAULT 0,
        stripe_payment_intent_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT client_packages_remaining_check CHECK (credits_remaining >= 0),
        CONSTRAINT client_packages_total_check CHECK (credits_total >= 0),
        CONSTRAINT client_packages_status_check CHECK (status IN ('active','expired','cancelled')),
        CONSTRAINT client_packages_eligible_check CHECK (jsonb_typeof(eligible_service_ids) = 'array')
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS client_packages_membership_unique ON "${s}".client_packages (client_membership_id) WHERE client_membership_id IS NOT NULL`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS client_packages_client_idx ON "${s}".client_packages (client_id, status)`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".credit_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_package_id uuid NOT NULL REFERENCES "${s}".client_packages(id) ON DELETE CASCADE,
        appointment_id uuid REFERENCES "${s}".appointments(id) ON DELETE SET NULL,
        enrollment_id uuid REFERENCES "${s}".class_enrollments(id) ON DELETE SET NULL,
        delta integer NOT NULL,
        reason text NOT NULL,
        balance_after integer NOT NULL DEFAULT 0,
        reference_id text,
        note text,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT credit_ledger_delta_check CHECK (delta <> 0),
        CONSTRAINT credit_ledger_balance_check CHECK (balance_after >= 0),
        CONSTRAINT credit_ledger_reason_check CHECK (reason IN ('purchase','grant','redeem','refund','expire','late_cancel','adjust')),
        CONSTRAINT credit_ledger_sign_check CHECK ((reason NOT IN ('purchase','grant','refund') OR delta > 0) AND (reason NOT IN ('redeem','expire','late_cancel') OR delta < 0))
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_reference_unique ON "${s}".credit_ledger (client_package_id, reason, reference_id) WHERE reference_id IS NOT NULL`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS credit_ledger_package_idx ON "${s}".credit_ledger (client_package_id, created_at)`,
    ),
    sql.raw(`
      CREATE OR REPLACE FUNCTION "${s}".client_packages_zero_on_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN NEW.credits_remaining := 0; RETURN NEW; END $fn$
    `),
    sql.raw(
      `DROP TRIGGER IF EXISTS client_packages_zero_on_insert_trg ON "${s}".client_packages`,
    ),
    sql.raw(`
      CREATE TRIGGER client_packages_zero_on_insert_trg BEFORE INSERT ON "${s}".client_packages
        FOR EACH ROW EXECUTE FUNCTION "${s}".client_packages_zero_on_insert()
    `),
    sql.raw(`
      CREATE OR REPLACE FUNCTION "${s}".credit_ledger_apply() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE cur integer; nxt integer;
      BEGIN
        SELECT credits_remaining INTO cur FROM "${s}".client_packages WHERE id = NEW.client_package_id FOR UPDATE;
        IF cur IS NULL THEN RAISE EXCEPTION 'package % not found', NEW.client_package_id USING ERRCODE = '23503'; END IF;
        nxt := cur + NEW.delta;
        IF nxt < 0 THEN
          RAISE EXCEPTION 'not enough credits' USING ERRCODE = '23514', CONSTRAINT = 'credit_ledger_insufficient';
        END IF;
        NEW.balance_after := nxt;
        UPDATE "${s}".client_packages
           SET credits_remaining = nxt,
               credits_total = credits_total + GREATEST(NEW.delta, 0) * (CASE WHEN NEW.reason IN ('purchase','grant') THEN 1 ELSE 0 END),
               updated_at = now()
         WHERE id = NEW.client_package_id;
        RETURN NEW;
      END $fn$
    `),
    sql.raw(
      `DROP TRIGGER IF EXISTS credit_ledger_apply_trg ON "${s}".credit_ledger`,
    ),
    sql.raw(`
      CREATE TRIGGER credit_ledger_apply_trg BEFORE INSERT ON "${s}".credit_ledger
        FOR EACH ROW EXECUTE FUNCTION "${s}".credit_ledger_apply()
    `),
    sql.raw(`
      CREATE OR REPLACE FUNCTION "${s}".credit_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN RAISE EXCEPTION 'credit_ledger rows are append-only' USING ERRCODE = '42501'; END $fn$
    `),
    sql.raw(
      `DROP TRIGGER IF EXISTS credit_ledger_immutable_trg ON "${s}".credit_ledger`,
    ),
    sql.raw(`
      CREATE TRIGGER credit_ledger_immutable_trg BEFORE UPDATE OF delta, reason, balance_after, client_package_id ON "${s}".credit_ledger
        FOR EACH ROW EXECUTE FUNCTION "${s}".credit_ledger_immutable()
    `),
    sql.raw(
      `ALTER TABLE "${s}".appointments ADD COLUMN IF NOT EXISTS credit_entry_id uuid REFERENCES "${s}".credit_ledger(id) ON DELETE SET NULL`,
    ),
    sql.raw(`
      DO $do$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'class_enrollments_credit_entry_fk' AND connamespace = '"${s}"'::regnamespace) THEN
          ALTER TABLE "${s}".class_enrollments ADD CONSTRAINT class_enrollments_credit_entry_fk FOREIGN KEY (credit_entry_id) REFERENCES "${s}".credit_ledger(id) ON DELETE SET NULL;
        END IF;
      END $do$
    `),
    sql.raw(
      `ALTER TABLE "${s}".charges ALTER COLUMN appointment_id DROP NOT NULL`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".charges ADD COLUMN IF NOT EXISTS client_package_id uuid REFERENCES "${s}".client_packages(id) ON DELETE SET NULL`,
    ),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`ALTER TABLE "${s}".charges DROP COLUMN IF EXISTS client_package_id`),
    // Lossy by design: pack-sale charges have no appointment and cannot satisfy NOT NULL.
    sql.raw(`DELETE FROM "${s}".charges WHERE appointment_id IS NULL`),
    sql.raw(
      `ALTER TABLE "${s}".charges ALTER COLUMN appointment_id SET NOT NULL`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".class_enrollments DROP CONSTRAINT IF EXISTS class_enrollments_credit_entry_fk`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".appointments DROP COLUMN IF EXISTS credit_entry_id`,
    ),
    sql.raw(
      `DROP TABLE IF EXISTS "${s}".credit_ledger`,
    ),
    sql.raw(
      `DROP FUNCTION IF EXISTS "${s}".credit_ledger_immutable()`,
    ),
    sql.raw(
      `DROP FUNCTION IF EXISTS "${s}".credit_ledger_apply()`,
    ),
    sql.raw(
      `DROP TABLE IF EXISTS "${s}".client_packages`,
    ),
    sql.raw(
      `DROP FUNCTION IF EXISTS "${s}".client_packages_zero_on_insert()`,
    ),
    sql.raw(
      `DROP TABLE IF EXISTS "${s}".packages`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".membership_plans DROP CONSTRAINT IF EXISTS membership_plans_credits_kind_check`,
    ),
    sql.raw(
      `ALTER TABLE "${s}".membership_plans DROP COLUMN IF EXISTS eligible_service_ids, DROP COLUMN IF EXISTS rollover_max, DROP COLUMN IF EXISTS credits_per_period, DROP COLUMN IF EXISTS kind`,
    ),
  ],
};
