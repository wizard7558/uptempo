ALTER TABLE "stylist_services" ADD COLUMN IF NOT EXISTS "price_cents" integer;--> statement-breakpoint
ALTER TABLE "stylist_services" ADD COLUMN IF NOT EXISTS "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "stylist_services" ADD COLUMN IF NOT EXISTS "active_minutes" integer;--> statement-breakpoint
ALTER TABLE "stylist_services" ADD COLUMN IF NOT EXISTS "processing_minutes" integer;--> statement-breakpoint
ALTER TABLE "stylist_services" ADD COLUMN IF NOT EXISTS "custom_name" text;--> statement-breakpoint
ALTER TABLE "stylist_services" ADD COLUMN IF NOT EXISTS "is_offered" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "stylist_services" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stylist_services_stylist_offered_idx" ON "stylist_services" USING btree ("stylist_id","is_offered");
