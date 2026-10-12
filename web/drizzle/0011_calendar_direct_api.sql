-- Migration: Replace Cronofy aggregator with direct Google Calendar + Microsoft Graph APIs
-- This migration updates the public schema tables. Tenant schemas are handled by provision.ts.
-- Existing calendar connections will be dropped (no data migration — fresh connections required).

-- 1. Drop calendar_push_targets table (push target now stored as calendarId on the connection)
--> statement-breakpoint
DROP TABLE IF EXISTS "calendar_push_targets";

-- 2. Alter calendar_connections: drop Cronofy columns, add platform-agnostic columns
--> statement-breakpoint
DROP INDEX IF EXISTS "calendar_connections_cronofy_account_idx";

--> statement-breakpoint
ALTER TABLE "calendar_connections" DROP COLUMN IF EXISTS "cronofy_account_id";
--> statement-breakpoint
ALTER TABLE "calendar_connections" DROP COLUMN IF EXISTS "provider_name";
--> statement-breakpoint
ALTER TABLE "calendar_connections" DROP COLUMN IF EXISTS "profile_id";
--> statement-breakpoint
ALTER TABLE "calendar_connections" DROP COLUMN IF EXISTS "profile_name";
--> statement-breakpoint
ALTER TABLE "calendar_connections" DROP COLUMN IF EXISTS "channel_id";

--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "platform" text NOT NULL DEFAULT 'google_calendar';
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "platform_user_id" text;
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "platform_email" text;
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "calendar_id" text;

--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_connections_stylist_platform_idx"
  ON "calendar_connections" ("stylist_id", "platform");

-- 3. Alter external_events: rename Cronofy-specific columns (idempotent)
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='external_events' AND column_name='cronofy_calendar_id') THEN
    ALTER TABLE "external_events" RENAME COLUMN "cronofy_calendar_id" TO "calendar_id";
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='external_events' AND column_name='cronofy_event_uid') THEN
    ALTER TABLE "external_events" RENAME COLUMN "cronofy_event_uid" TO "event_uid";
  END IF;
END $$;

-- 4. Alter appointments: rename cronofy_event_id to calendar_event_id (idempotent)
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='cronofy_event_id') THEN
    ALTER TABLE "appointments" RENAME COLUMN "cronofy_event_id" TO "calendar_event_id";
  END IF;
END $$;
