-- Migration: Public Schema Catch-Up
-- Reconciles public-schema drift that accumulated while this repo used
-- `drizzle-kit push` plus a few hand-written SQL patches outside Drizzle's
-- metadata journal. This migration is the canonical catch-up point that
-- brings the journal/snapshot chain back in sync with the current schema.
--
-- Covered changes:
-- - domain_mappings table
-- - otp_rate_limits table
-- - tenants.plan
-- - tenants.platform_fee_percent
-- - tenants.assistant_seats

CREATE TABLE "domain_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_slug" text NOT NULL,
	"domain" text NOT NULL,
	"type" text DEFAULT 'custom' NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"ssl_status" text DEFAULT 'pending' NOT NULL,
	"stripe_registered" text DEFAULT 'pending' NOT NULL,
	"is_primary" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_slug" text NOT NULL,
	"scope" text NOT NULL,
	"normalized_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan" text DEFAULT 'starter' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "platform_fee_percent" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "assistant_seats" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "domain_mappings_domain_unique" ON "domain_mappings" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domain_mappings_tenant_slug_idx" ON "domain_mappings" USING btree ("tenant_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_rate_limits_scope_key_unique" ON "otp_rate_limits" USING btree ("tenant_slug","scope","normalized_key");--> statement-breakpoint
CREATE INDEX "otp_rate_limits_updated_at_idx" ON "otp_rate_limits" USING btree ("updated_at");
