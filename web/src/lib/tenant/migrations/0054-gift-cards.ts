import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0054 (Phase 3.6): gift cards.
 *
 * A sale is a liability: the card plus an `issue` ledger row. Redemption
 * later writes `charges.gift_card_id` and `charges.gift_card_cents`.
 * The code itself is never stored, only its SHA-256 and last 4 characters.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 54,
  description: "Gift cards, ledger, and charge redemption columns",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".gift_cards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code_hash text NOT NULL,
        last4 text NOT NULL,
        initial_cents integer NOT NULL,
        balance_cents integer NOT NULL,
        status text NOT NULL DEFAULT 'active',
        source text NOT NULL,
        purchaser_client_id uuid REFERENCES "${s}".clients(id) ON DELETE SET NULL,
        purchaser_name text,
        purchaser_email text,
        recipient_name text,
        recipient_email text,
        message text,
        stripe_checkout_session_id text,
        stripe_payment_intent_id text,
        platform_fee_cents integer NOT NULL DEFAULT 0,
        replaced_by_id uuid REFERENCES "${s}".gift_cards(id) ON DELETE SET NULL,
        delivered_at timestamptz,
        expires_at timestamptz,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT gift_cards_code_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT gift_cards_last4_check CHECK (last4 ~ '^[0-9A-HJKMNP-TV-Z]{4}$'),
        CONSTRAINT gift_cards_initial_check CHECK (
          initial_cents BETWEEN 1 AND 100000
          AND (source = 'replacement' OR initial_cents >= 100)
        ),
        CONSTRAINT gift_cards_balance_check CHECK (balance_cents >= 0 AND balance_cents <= 100000),
        CONSTRAINT gift_cards_status_check CHECK (status IN ('active','void')),
        CONSTRAINT gift_cards_source_check CHECK (source IN ('online','in_person','comp','replacement')),
        CONSTRAINT gift_cards_message_check CHECK (message IS NULL OR char_length(message) <= 200)
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_code_hash_unique ON "${s}".gift_cards (code_hash)`,
    ),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS gift_cards_checkout_session_unique ON "${s}".gift_cards (stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS gift_cards_created_idx ON "${s}".gift_cards (created_at)`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".gift_card_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        gift_card_id uuid NOT NULL REFERENCES "${s}".gift_cards(id) ON DELETE RESTRICT,
        charge_id uuid REFERENCES "${s}".charges(id) ON DELETE SET NULL,
        appointment_id uuid REFERENCES "${s}".appointments(id) ON DELETE SET NULL,
        delta_cents integer NOT NULL,
        balance_after_cents integer NOT NULL,
        reason text NOT NULL,
        note text,
        created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT gift_card_transactions_reason_check CHECK (reason IN ('issue','redeem','reversal','adjustment','void')),
        CONSTRAINT gift_card_transactions_delta_check CHECK (delta_cents <> 0),
        CONSTRAINT gift_card_transactions_balance_check CHECK (balance_after_cents >= 0)
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS gift_card_transactions_card_idx ON "${s}".gift_card_transactions (gift_card_id, created_at)`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS gift_card_transactions_charge_idx ON "${s}".gift_card_transactions (charge_id) WHERE charge_id IS NOT NULL`,
    ),
    sql.raw(`
      ALTER TABLE "${s}".charges
        ADD COLUMN IF NOT EXISTS gift_card_id uuid REFERENCES "${s}".gift_cards(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS gift_card_cents integer CONSTRAINT charges_gift_card_cents_check CHECK (gift_card_cents IS NULL OR gift_card_cents > 0)
    `),
  ],
  down: (s: string): SQL[] => [
    sql.raw(
      `ALTER TABLE "${s}".charges DROP COLUMN IF EXISTS gift_card_cents, DROP COLUMN IF EXISTS gift_card_id`,
    ),
    sql.raw(`DROP TABLE IF EXISTS "${s}".gift_card_transactions`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".gift_cards`),
  ],
};
