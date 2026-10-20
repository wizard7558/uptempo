ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sms_line_status" text;--> statement-breakpoint
UPDATE "tenants" SET "sms_line_status" = 'shared' WHERE "sms_line_status" IS NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "sms_line_status" SET DEFAULT 'off';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "sms_line_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sms_brand_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sms_campaign_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sms_messaging_service_sid" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sms_phone_number" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sms_registration" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_sms_line_status_check'
      AND conrelid = '"tenants"'::regclass
  ) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_sms_line_status_check"
      CHECK ("sms_line_status" IN ('off', 'shared', 'pending', 'action_needed', 'active'));
  END IF;
END $$;
