import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0023: allow standalone assistant tasks (not tied to a client booking).
 *
 * Until now, every row in `assistant_tasks` had to reference a booked
 * appointment. That blocked the common case of "morning prep / color
 * mixing / clean station" — recurring standalone tasks the owner adds
 * to an assistant's schedule each day, independent of any one client.
 *
 * Drops NOT NULL on `appointment_id`. The FK and the no-overlap
 * exclusion constraint stay intact.
 */
export const migration: TenantMigration = {
  version: 23,
  description:
    "assistant_tasks.appointment_id nullable for standalone tasks",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."assistant_tasks"
        ALTER COLUMN "appointment_id" DROP NOT NULL
    `),
  ],
};
