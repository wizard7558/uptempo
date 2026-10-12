ALTER TABLE "user" ADD COLUMN "tenant_slug" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "onboarding_steps" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_stripe_connect_account_unique" ON "tenants" USING btree ("stripe_connect_account_id");