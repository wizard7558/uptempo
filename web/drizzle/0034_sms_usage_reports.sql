-- Down: drizzle/rollback/0034_sms_usage_reports.down.sql
-- Phase 6.1d: one row per business per UTC day once that day's billed texts are
-- reported to the Stripe texts meter. Unique (tenant_slug, usage_date) keeps the
-- nightly report idempotent. Safe to run twice.
CREATE TABLE IF NOT EXISTS "sms_usage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_slug" text NOT NULL,
	"usage_date" date NOT NULL,
	"quantity" integer NOT NULL,
	"meter_event_identifier" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_usage_reports_tenant_date_unique" UNIQUE("tenant_slug","usage_date")
);
