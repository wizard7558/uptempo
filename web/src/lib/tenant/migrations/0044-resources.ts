import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0044 (Phase 2): rooms, chairs and equipment with capacity enforced
 * by the database.
 *
 * - resources: a bookable thing with a capacity (1 = one person at a time).
 * - service_resource_requirements: what a service needs (a type or one specific
 *   resource), with an offset and length inside the service.
 * - appointment_resources: which resource a booking holds, and when. Capacity 1
 *   is an exclusion constraint (appointment_resources_no_overlap, partial on
 *   is_exclusive = 1). Capacity > 1 cannot be an exclusion constraint, so a
 *   BEFORE trigger sets is_exclusive from resources.capacity (the client is not
 *   trusted), takes an advisory lock per resource, counts peak concurrent use and
 *   raises 23P01 with constraint appointment_resources_capacity when it is full.
 * - Cancelling an appointment deletes its resource rows.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 44,
  description: "Resources with DB-enforced capacity",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".resources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        location_id uuid REFERENCES "${s}".locations(id) ON DELETE SET NULL,
        kind text NOT NULL,
        name text NOT NULL,
        capacity integer NOT NULL DEFAULT 1,
        is_active integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT resources_kind_check CHECK (kind IN ('room','chair','station','equipment','vehicle')),
        CONSTRAINT resources_capacity_check CHECK (capacity BETWEEN 1 AND 500),
        CONSTRAINT resources_active_check CHECK (is_active IN (0,1))
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS resources_location_kind_idx ON "${s}".resources (location_id, kind) WHERE is_active = 1`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".service_resource_requirements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        service_id uuid NOT NULL REFERENCES "${s}".services(id) ON DELETE CASCADE,
        resource_kind text,
        resource_id uuid REFERENCES "${s}".resources(id) ON DELETE CASCADE,
        quantity integer NOT NULL DEFAULT 1,
        offset_min integer NOT NULL DEFAULT 0,
        duration_min integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT srr_target_check CHECK ((resource_kind IS NULL) <> (resource_id IS NULL)),
        CONSTRAINT srr_kind_check CHECK (resource_kind IS NULL OR resource_kind IN ('room','chair','station','equipment','vehicle')),
        CONSTRAINT srr_quantity_check CHECK (quantity BETWEEN 1 AND 20),
        CONSTRAINT srr_window_check CHECK (offset_min >= 0 AND (duration_min IS NULL OR duration_min > 0))
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS srr_service_idx ON "${s}".service_resource_requirements (service_id)`,
    ),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".appointment_resources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        appointment_id uuid NOT NULL REFERENCES "${s}".appointments(id) ON DELETE CASCADE,
        resource_id uuid NOT NULL REFERENCES "${s}".resources(id) ON DELETE RESTRICT,
        during tstzrange NOT NULL,
        is_exclusive integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT appointment_resources_exclusive_check CHECK (is_exclusive IN (0,1)),
        CONSTRAINT appointment_resources_no_overlap EXCLUDE USING gist (resource_id WITH =, during WITH &&) WHERE (is_exclusive = 1)
      )
    `),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS appointment_resources_appointment_idx ON "${s}".appointment_resources (appointment_id)`,
    ),
    sql.raw(
      `CREATE INDEX IF NOT EXISTS appointment_resources_resource_during_idx ON "${s}".appointment_resources USING gist (resource_id, during)`,
    ),
    sql.raw(`
      CREATE OR REPLACE FUNCTION "${s}".appointment_resources_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
      DECLARE cap integer; peak integer;
      BEGIN
        SELECT capacity INTO cap FROM "${s}".resources WHERE id = NEW.resource_id;
        IF cap IS NULL THEN RAISE EXCEPTION 'resource % not found', NEW.resource_id USING ERRCODE = '23503'; END IF;
        IF cap = 1 THEN NEW.is_exclusive := 1; RETURN NEW; END IF;
        NEW.is_exclusive := 0;
        PERFORM pg_advisory_xact_lock(hashtextextended('appointment_resources:' || NEW.resource_id::text, 0));
        SELECT COALESCE(MAX(cnt), 0) INTO peak FROM (
          SELECT p.pt, COUNT(o.id) AS cnt
          FROM (
            SELECT lower(NEW.during) AS pt
            UNION
            SELECT lower(x.during) FROM "${s}".appointment_resources x
             WHERE x.resource_id = NEW.resource_id AND x.id <> NEW.id
               AND x.during && NEW.during AND lower(x.during) > lower(NEW.during)
          ) p
          JOIN "${s}".appointment_resources o
            ON o.resource_id = NEW.resource_id AND o.id <> NEW.id AND o.during @> p.pt
          GROUP BY p.pt
        ) peaks;
        IF peak >= cap THEN
          RAISE EXCEPTION 'resource % is full', NEW.resource_id
            USING ERRCODE = '23P01', CONSTRAINT = 'appointment_resources_capacity';
        END IF;
        RETURN NEW;
      END $fn$
    `),
    sql.raw(`DROP TRIGGER IF EXISTS appointment_resources_guard_trg ON "${s}".appointment_resources`),
    sql.raw(`
      CREATE TRIGGER appointment_resources_guard_trg BEFORE INSERT OR UPDATE OF resource_id, during
        ON "${s}".appointment_resources FOR EACH ROW EXECUTE FUNCTION "${s}".appointment_resources_guard()
    `),
    sql.raw(`
      CREATE OR REPLACE FUNCTION "${s}".appointments_release_resources() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN DELETE FROM "${s}".appointment_resources WHERE appointment_id = NEW.id; RETURN NEW; END $fn$
    `),
    sql.raw(`DROP TRIGGER IF EXISTS appointments_release_resources_trg ON "${s}".appointments`),
    sql.raw(`
      CREATE TRIGGER appointments_release_resources_trg AFTER UPDATE OF status ON "${s}".appointments
        FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
        EXECUTE FUNCTION "${s}".appointments_release_resources()
    `),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`DROP TRIGGER IF EXISTS appointments_release_resources_trg ON "${s}".appointments`),
    sql.raw(`DROP FUNCTION IF EXISTS "${s}".appointments_release_resources()`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".appointment_resources`),
    sql.raw(`DROP FUNCTION IF EXISTS "${s}".appointment_resources_guard()`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".service_resource_requirements`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".resources`),
  ],
};
