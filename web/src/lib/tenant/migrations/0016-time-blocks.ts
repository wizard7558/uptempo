import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0016: Internal time blocks (busy between clients) per stylist + location lane.
 */
export const migration: TenantMigration = {
  version: 16,
  description: "time_blocks table with overlap exclusion (stylist + location + during)",
  up: (schemaName: string): SQL[] => [
    sql.raw(`CREATE EXTENSION IF NOT EXISTS btree_gist`),
    sql.raw(`
      CREATE TABLE "${schemaName}"."time_blocks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "stylist_id" uuid NOT NULL REFERENCES "${schemaName}"."stylists"("id") ON DELETE CASCADE,
        "location_id" uuid REFERENCES "${schemaName}"."locations"("id") ON DELETE SET NULL,
        "during" tstzrange NOT NULL,
        "label" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `),
    sql.raw(`
      CREATE INDEX "time_blocks_stylist_during_idx"
        ON "${schemaName}"."time_blocks" USING btree ("stylist_id")
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."time_blocks"
        ADD CONSTRAINT "time_blocks_no_overlap"
        EXCLUDE USING gist (
          stylist_id WITH =,
          (COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
          during WITH &&
        )
    `),
  ],
};
