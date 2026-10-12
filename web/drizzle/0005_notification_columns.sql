CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"stylist_id" uuid NOT NULL,
	"cronofy_account_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"provider_name" text NOT NULL,
	"profile_id" text NOT NULL,
	"profile_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"error_message" text,
	"channel_id" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_push_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"stylist_id" uuid NOT NULL,
	"cronofy_calendar_id" text NOT NULL,
	"calendar_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"stylist_id" uuid NOT NULL,
	"cronofy_calendar_id" text NOT NULL,
	"cronofy_event_uid" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"is_all_day" integer DEFAULT 0 NOT NULL,
	"free_busy_status" text DEFAULT 'busy' NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cronofy_event_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "calendar_sync_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "confirmation_enabled" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "reminder_enabled" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "reminder_hours_before" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "confirmation_greeting" text;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "confirmation_body" text;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "reminder_greeting" text;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "reminder_body" text;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "salon_address" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_stylist_id_stylists_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."stylists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_push_targets" ADD CONSTRAINT "calendar_push_targets_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_push_targets" ADD CONSTRAINT "calendar_push_targets_stylist_id_stylists_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."stylists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_events" ADD CONSTRAINT "external_events_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_connections_stylist_id_idx" ON "calendar_connections" USING btree ("stylist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_cronofy_account_idx" ON "calendar_connections" USING btree ("cronofy_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_push_targets_stylist_idx" ON "calendar_push_targets" USING btree ("stylist_id");--> statement-breakpoint
CREATE INDEX "external_events_stylist_time_idx" ON "external_events" USING btree ("stylist_id","start_time","end_time");--> statement-breakpoint
CREATE INDEX "external_events_connection_idx" ON "external_events" USING btree ("connection_id");