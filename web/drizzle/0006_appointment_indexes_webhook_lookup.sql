-- Migration: Appointment Indexes + Webhook Lookup Table
-- Adds missing indexes to appointments table for schedule queries and cron jobs.
-- Creates webhook_lookup table for O(1) tenant resolution in webhook handlers.

CREATE TABLE IF NOT EXISTS "webhook_lookup" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "lookup_type" text NOT NULL,
  "external_id" text NOT NULL,
  "tenant_slug" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_lookup_type_external_id_idx" ON "webhook_lookup" USING btree ("lookup_type","external_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_lookup_tenant_slug_idx" ON "webhook_lookup" USING btree ("tenant_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_stylist_status_idx" ON "appointments" USING btree ("stylist_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_client_id_idx" ON "appointments" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_calendar_sync_status_idx" ON "appointments" USING btree ("calendar_sync_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_reminder_sent_at_idx" ON "appointments" USING btree ("reminder_sent_at");
