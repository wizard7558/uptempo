-- Down: drizzle/rollback/0032_card_processing_rate.down.sql
-- Phase 6.2a: one card processing rate, and the end of the monthly minimum.
-- comped: 1 where the business was fee-exempt (platform_fee_percent = 0) (D10).
-- processing_rate_bps: each existing business keeps its current per-charge rate
-- until its switch (D11): the explicit platform_fee_percent x 100, else the plan
-- default (starter 50, pro 100, business 200; any other plan 0 so it
-- does not pick up the 500 bps default). New rows stay null and follow
-- PLATFORM_PROCESSING_RATE_BPS.
-- The backfills run only in the run that adds the columns, so a second run
-- (or a re-run after a business was un-comped or switched) changes nothing.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'comped'
	) THEN
		ALTER TABLE "tenants" ADD COLUMN "comped" integer DEFAULT 0 NOT NULL;
		UPDATE "tenants" SET "comped" = 1 WHERE "platform_fee_percent" = 0;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'processing_rate_bps'
	) THEN
		ALTER TABLE "tenants" ADD COLUMN "processing_rate_bps" integer;
		UPDATE "tenants" SET "processing_rate_bps" = LEAST(1000, COALESCE(
			"platform_fee_percent" * 100,
			CASE "plan" WHEN 'starter' THEN 50 WHEN 'pro' THEN 100 WHEN 'business' THEN 200 ELSE 0 END
		));
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_processing_rate_bps_range";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_processing_rate_bps_range" CHECK ("tenants"."processing_rate_bps" IS NULL OR ("tenants"."processing_rate_bps" >= 0 AND "tenants"."processing_rate_bps" <= 1000));
