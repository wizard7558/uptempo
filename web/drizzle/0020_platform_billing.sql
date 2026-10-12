-- Paid platform billing. Per-tenant opt-in flag + the salon's platform-account
-- Stripe customer/card, plus a ledger of monthly platform-fee charges.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_enabled" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "platform_stripe_customer_id" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "platform_payment_method_id" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_slug" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"floor_cents" integer NOT NULL,
	"fee_percent" text,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"fees_collected_cents" integer DEFAULT 0 NOT NULL,
	"amount_charged_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_charges_tenant_period_unique" ON "platform_charges" ("tenant_slug", "period_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_charges_tenant_idx" ON "platform_charges" ("tenant_slug");
