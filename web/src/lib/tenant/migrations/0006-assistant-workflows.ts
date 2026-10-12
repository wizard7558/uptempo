import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0006: Add assistant workflow tables.
 * Adds role column to stylists, task_catalog table, and assistant_tasks table
 * with exclusion constraint preventing double-assignment.
 */
export const migration: TenantMigration = {
  version: 6,
  description:
    "Add assistant workflow tables: role column, task_catalog, assistant_tasks",
  up: (schemaName: string): SQL[] => [
    // Add role column to stylists
    sql.raw(`
      ALTER TABLE "${schemaName}".stylists
        ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'stylist'
    `),

    // Create task_catalog table
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."task_catalog" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "default_duration_minutes" integer NOT NULL,
        "is_active" integer DEFAULT 1 NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `),

    // Create assistant_tasks table
    sql.raw(`
      CREATE TABLE IF NOT EXISTS "${schemaName}"."assistant_tasks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "appointment_id" uuid NOT NULL REFERENCES "${schemaName}"."appointments"("id") ON DELETE CASCADE,
        "assigned_to" uuid NOT NULL REFERENCES "${schemaName}"."stylists"("id"),
        "task_type_id" uuid REFERENCES "${schemaName}"."task_catalog"("id"),
        "task_name" text NOT NULL,
        "during" tstzrange NOT NULL,
        "status" text DEFAULT 'pending' NOT NULL,
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      )
    `),

    // Add exclusion constraint to prevent overlapping tasks for same assistant
    sql.raw(`
      ALTER TABLE "${schemaName}"."assistant_tasks"
        ADD CONSTRAINT "assistant_tasks_no_overlap"
        EXCLUDE USING gist (
          assigned_to WITH =,
          during WITH &&
        )
        WHERE (status != 'cancelled')
    `),

    // Indexes for assistant_tasks
    sql.raw(`
      CREATE INDEX IF NOT EXISTS assistant_tasks_appointment_idx
        ON "${schemaName}"."assistant_tasks" ("appointment_id")
    `),
    sql.raw(`
      CREATE INDEX IF NOT EXISTS assistant_tasks_assigned_to_idx
        ON "${schemaName}"."assistant_tasks" ("assigned_to")
    `),
  ],
};
