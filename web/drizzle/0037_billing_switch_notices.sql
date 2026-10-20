ALTER TABLE "tenants" ADD COLUMN "billing_notice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_switch_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_notice_payload_hash" text;--> statement-breakpoint
-- Adding the nullable column without a default keeps every existing business
-- on its pre-switch terms. The default applies only to subsequently created rows.
ALTER TABLE "tenants" ADD COLUMN "billing_switched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "billing_switched_at" SET DEFAULT now();
