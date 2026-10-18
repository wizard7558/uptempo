-- Down: drizzle/rollback/0033_hosted_subscription.down.sql
-- Phase 6.1b: the hosted subscription on the platform Stripe account.
-- stripe_subscription_id is unique when set; subscription_status mirrors Stripe;
-- billable_staff is the last synced staff count. Safe to run twice.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billable_staff" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_stripe_subscription_unique" ON "tenants" USING btree ("stripe_subscription_id") WHERE "tenants"."stripe_subscription_id" IS NOT NULL;
