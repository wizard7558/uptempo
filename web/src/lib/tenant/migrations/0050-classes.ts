import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0050 (Phase 3.4): classes with capacity enforced by the database.
 *
 * - services.is_class / class_capacity: a service that runs as a group class.
 * - class_sessions: one scheduled run of a class (time range, staff, capacity,
 *   waitlist size).
 * - class_enrollments: a client's spot (booked) or place in line (waitlisted).
 *   A BEFORE trigger takes an advisory lock per session, checks the session is
 *   open, counts booked rows and raises 23P01 (class_enrollments_capacity) when
 *   full. Waitlist positions are assigned by the trigger and capped by
 *   waitlist_capacity (class_enrollments_waitlist_full). Updates that do not
 *   change status skip the trigger body, so editing a full session's rows is safe.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 50,
  description: "Classes with DB-enforced capacity",
  up: (s: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${s}".services
        ADD COLUMN IF NOT EXISTS is_class integer NOT NULL DEFAULT 0 CONSTRAINT services_is_class_check CHECK (is_class IN (0,1)),
        ADD COLUMN IF NOT EXISTS class_capacity integer CONSTRAINT services_class_capacity_check CHECK (class_capacity IS NULL OR class_capacity BETWEEN 1 AND 500)
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".class_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        service_id uuid NOT NULL REFERENCES "${s}".services(id) ON DELETE RESTRICT,
        staff_id uuid NOT NULL REFERENCES "${s}".staff(id) ON DELETE RESTRICT,
        location_id uuid REFERENCES "${s}".locations(id) ON DELETE SET NULL,
        resource_id uuid REFERENCES "${s}".resources(id) ON DELETE SET NULL,
        during tstzrange NOT NULL,
        capacity integer NOT NULL,
        waitlist_capacity integer NOT NULL DEFAULT 10,
        status text NOT NULL DEFAULT 'scheduled',
        series_id uuid,
        time_block_id uuid REFERENCES "${s}".time_blocks(id) ON DELETE SET NULL,
        price_cents integer,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT class_sessions_capacity_check CHECK (capacity BETWEEN 1 AND 500),
        CONSTRAINT class_sessions_waitlist_check CHECK (waitlist_capacity BETWEEN 0 AND 500),
        CONSTRAINT class_sessions_status_check CHECK (status IN ('scheduled','cancelled','completed')),
        CONSTRAINT class_sessions_during_check CHECK (NOT isempty(during) AND NOT lower_inf(during) AND NOT upper_inf(during)),
        CONSTRAINT class_sessions_price_check CHECK (price_cents IS NULL OR price_cents >= 0)
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS class_sessions_start_idx ON "${s}".class_sessions (lower(during)) WHERE status = 'scheduled'`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS class_sessions_series_idx ON "${s}".class_sessions (series_id) WHERE series_id IS NOT NULL`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".class_enrollments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id uuid NOT NULL REFERENCES "${s}".class_sessions(id) ON DELETE CASCADE,
        client_id uuid NOT NULL REFERENCES "${s}".clients(id) ON DELETE CASCADE,
        status text NOT NULL,
        waitlist_position integer,
        credit_entry_id uuid,
        promoted_at timestamptz,
        cancelled_at timestamptz,
        checked_in_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT class_enrollments_status_check CHECK (status IN ('booked','waitlisted','attended','no_show','late_cancel','cancelled')),
        CONSTRAINT class_enrollments_waitlist_pos_check CHECK ((status = 'waitlisted') = (waitlist_position IS NOT NULL))
      )
    `),
    sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS class_enrollments_active_unique ON "${s}".class_enrollments (session_id, client_id) WHERE status IN ('booked','waitlisted')`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS class_enrollments_session_status_idx ON "${s}".class_enrollments (session_id, status, waitlist_position)`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS class_enrollments_client_idx ON "${s}".class_enrollments (client_id)`,
    ),
    sql.raw(`
      CREATE OR REPLACE FUNCTION "${s}".class_enrollments_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE cap integer; wcap integer; sstatus text; used integer;
      BEGIN
        IF NEW.status NOT IN ('booked','waitlisted') THEN
          NEW.waitlist_position := NULL;
          RETURN NEW;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended('class_sessions:' || NEW.session_id::text, 0));
        SELECT capacity, waitlist_capacity, status INTO cap, wcap, sstatus FROM "${s}".class_sessions WHERE id = NEW.session_id;
        IF sstatus IS DISTINCT FROM 'scheduled' THEN
          RAISE EXCEPTION 'class session % is not open', NEW.session_id USING ERRCODE = '23514', CONSTRAINT = 'class_enrollments_session_open';
        END IF;
        IF NEW.status = 'booked' THEN
          NEW.waitlist_position := NULL;
          SELECT count(*) INTO used FROM "${s}".class_enrollments WHERE session_id = NEW.session_id AND status = 'booked' AND id <> NEW.id;
          IF used >= cap THEN
            RAISE EXCEPTION 'class session % is full', NEW.session_id USING ERRCODE = '23P01', CONSTRAINT = 'class_enrollments_capacity';
          END IF;
        ELSE
          SELECT count(*) INTO used FROM "${s}".class_enrollments WHERE session_id = NEW.session_id AND status = 'waitlisted' AND id <> NEW.id;
          IF used >= wcap THEN
            RAISE EXCEPTION 'class session % waitlist is full', NEW.session_id USING ERRCODE = '23P01', CONSTRAINT = 'class_enrollments_waitlist_full';
          END IF;
          IF NEW.waitlist_position IS NULL THEN
            SELECT COALESCE(max(waitlist_position), 0) + 1 INTO NEW.waitlist_position FROM "${s}".class_enrollments
             WHERE session_id = NEW.session_id AND status = 'waitlisted' AND id <> NEW.id;
          END IF;
        END IF;
        RETURN NEW;
      END $fn$
    `),
    sql.raw(`DROP TRIGGER IF EXISTS class_enrollments_guard_trg ON "${s}".class_enrollments`),
    sql.raw(`
      CREATE TRIGGER class_enrollments_guard_trg BEFORE INSERT OR UPDATE OF status ON "${s}".class_enrollments
        FOR EACH ROW EXECUTE FUNCTION "${s}".class_enrollments_guard()
    `),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`DROP TRIGGER IF EXISTS class_enrollments_guard_trg ON "${s}".class_enrollments`),
    sql.raw(`DROP FUNCTION IF EXISTS "${s}".class_enrollments_guard()`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".class_enrollments`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".class_sessions`),
    sql.raw(
      `ALTER TABLE "${s}".services DROP COLUMN IF EXISTS class_capacity, DROP COLUMN IF EXISTS is_class`,
    ),
  ],
};
