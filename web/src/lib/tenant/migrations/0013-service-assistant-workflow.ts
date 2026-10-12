import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantMigration } from "./index";

/**
 * Migration 0013: Service-level assistant workflow + stylist default assistant.
 * - services.assistant_workflow: when any booked service has this flag, auto-schedule
 *   one assistant task for the stylist's default_assistant for the appointment window.
 * - services.assistant_task_type_id: optional task catalog preset for label/task type.
 * - stylists.default_assistant_id: assistant who works with this stylist (stylist role only).
 * - assistant_tasks.is_auto: 1 = generated from service rules; 0 = manual.
 */
export const migration: TenantMigration = {
  version: 13,
  description:
    "Service assistant workflow columns, stylist default assistant, assistant_tasks.is_auto",
  up: (schemaName: string): SQL[] => [
    sql.raw(`
      ALTER TABLE "${schemaName}"."services"
        ADD COLUMN IF NOT EXISTS "assistant_workflow" integer NOT NULL DEFAULT 0
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."services"
        ADD COLUMN IF NOT EXISTS "assistant_task_type_id" uuid
        REFERENCES "${schemaName}"."task_catalog"("id") ON DELETE SET NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."stylists"
        ADD COLUMN IF NOT EXISTS "default_assistant_id" uuid
        REFERENCES "${schemaName}"."stylists"("id") ON DELETE SET NULL
    `),
    sql.raw(`
      ALTER TABLE "${schemaName}"."assistant_tasks"
        ADD COLUMN IF NOT EXISTS "is_auto" integer NOT NULL DEFAULT 0
    `),
  ],
};
