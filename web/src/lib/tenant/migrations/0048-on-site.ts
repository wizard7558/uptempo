import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0048 (Phase 3.2): on-site visits.
 *
 * - client_addresses: where a client wants the visit (lat/lng come from the ZIP centroid or a manual pin).
 * - service_areas: ZIP lists or radius areas, business-wide (staff_id NULL) or per staff member.
 * - staff_travel_settings: where a staff member starts the day and how they drive.
 * - appointments / booking_requests / business_settings gain address and arrival window columns.
 *
 * Every statement is safe to run again.
 */
export const migration: TenantMigration = {
  version: 48,
  description: "On-site addresses, service areas, travel settings, arrival windows",
  up: (s: string): SQL[] => [
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".client_addresses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES "${s}".clients(id) ON DELETE CASCADE,
        label text,
        line1 text NOT NULL,
        line2 text,
        city text,
        region text,
        postal_code text NOT NULL,
        country text NOT NULL DEFAULT 'US',
        lat double precision,
        lng double precision,
        geo_source text,
        access_notes text,
        is_default integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT client_addresses_geo_check CHECK ((lat IS NULL) = (lng IS NULL) AND (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))),
        CONSTRAINT client_addresses_geo_source_check CHECK (geo_source IS NULL OR geo_source IN ('postal_centroid','manual')),
        CONSTRAINT client_addresses_default_check CHECK (is_default IN (0,1))
      )
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS client_addresses_client_idx ON "${s}".client_addresses (client_id)
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".service_areas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id uuid REFERENCES "${s}".staff(id) ON DELETE CASCADE,
        name text NOT NULL,
        kind text NOT NULL,
        postal_codes text[] NOT NULL DEFAULT '{}',
        center_lat double precision,
        center_lng double precision,
        radius_km numeric(6,2),
        is_active integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT service_areas_kind_check CHECK (kind IN ('postal_codes','radius')),
        CONSTRAINT service_areas_postal_check CHECK (kind <> 'postal_codes' OR cardinality(postal_codes) BETWEEN 1 AND 2000),
        CONSTRAINT service_areas_radius_check CHECK (kind <> 'radius' OR (center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_km > 0 AND radius_km <= 500)),
        CONSTRAINT service_areas_active_check CHECK (is_active IN (0,1))
      )
    `),
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${s}".staff_travel_settings (
        staff_id uuid PRIMARY KEY REFERENCES "${s}".staff(id) ON DELETE CASCADE,
        base_postal_code text,
        base_lat double precision NOT NULL,
        base_lng double precision NOT NULL,
        max_travel_min integer NOT NULL DEFAULT 60,
        travel_buffer_min integer NOT NULL DEFAULT 0,
        speed_kmh integer NOT NULL DEFAULT 40,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT staff_travel_base_check CHECK (base_lat BETWEEN -90 AND 90 AND base_lng BETWEEN -180 AND 180),
        CONSTRAINT staff_travel_max_check CHECK (max_travel_min BETWEEN 5 AND 480),
        CONSTRAINT staff_travel_buffer_check CHECK (travel_buffer_min BETWEEN 0 AND 120),
        CONSTRAINT staff_travel_speed_check CHECK (speed_kmh BETWEEN 5 AND 130)
      )
    `),
    sql.raw(`
      ALTER TABLE "${s}".appointments
        ADD COLUMN IF NOT EXISTS service_address_id uuid REFERENCES "${s}".client_addresses(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS arrival_window_min integer CONSTRAINT appointments_arrival_window_check CHECK (arrival_window_min IS NULL OR arrival_window_min BETWEEN 0 AND 480),
        ADD COLUMN IF NOT EXISTS on_my_way_sent_at timestamptz
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS appointments_service_address_idx ON "${s}".appointments (service_address_id) WHERE service_address_id IS NOT NULL
    `),
    sql.raw(`
      ALTER TABLE "${s}".booking_requests ADD COLUMN IF NOT EXISTS address_id uuid REFERENCES "${s}".client_addresses(id) ON DELETE SET NULL
    `),
    sql.raw(`
      ALTER TABLE "${s}".business_settings ADD COLUMN IF NOT EXISTS arrival_window_min integer NOT NULL DEFAULT 120
        CONSTRAINT business_settings_arrival_window_check CHECK (arrival_window_min IN (0,30,60,120,180,240))
    `),
  ],
  down: (s: string): SQL[] => [
    sql.raw(`ALTER TABLE "${s}".business_settings DROP COLUMN IF EXISTS arrival_window_min`),
    sql.raw(`ALTER TABLE "${s}".booking_requests DROP COLUMN IF EXISTS address_id`),
    sql.raw(`DROP INDEX IF EXISTS "${s}".appointments_service_address_idx`),
    sql.raw(`
      ALTER TABLE "${s}".appointments
        DROP COLUMN IF EXISTS on_my_way_sent_at,
        DROP COLUMN IF EXISTS arrival_window_min,
        DROP COLUMN IF EXISTS service_address_id
    `),
    sql.raw(`DROP TABLE IF EXISTS "${s}".staff_travel_settings`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".service_areas`),
    sql.raw(`DROP TABLE IF EXISTS "${s}".client_addresses`),
  ],
};
