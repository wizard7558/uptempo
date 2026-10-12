-- Phase 1.2: per-tenant industry pack, enabled modules, terminology overrides
-- and database shard. Hand-written like 0022/0023 (drizzle snapshots stop at
-- 0010, so `drizzle-kit generate` cannot run non-interactively); SQL matches
-- what the schema in src/lib/db/schema/tenants.ts requires.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "industry" text DEFAULT 'hair_salon' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "modules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "terminology" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "db_shard" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
-- Backfill: every existing tenant gets the hair_salon pack's module list
-- (src/lib/verticals/hair-salon.ts) so today's features stay on.
UPDATE "tenants" SET "modules" = '["processing_time","assistant_tasks","memberships","slot_waitlist","gift_cards","storefront","aftercare"]'::jsonb WHERE "modules" = '[]'::jsonb;
