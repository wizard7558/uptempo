CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"salon_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"stripe_payment_intent_id" text,
	"amount_cents" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_refund_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "stripe_payment_method_id" text;--> statement-breakpoint
ALTER TABLE "salon_policies" ADD COLUMN "require_card_on_file" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD COLUMN "price_charged_cents" integer;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_appointment_id_idx" ON "charges" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "charges_client_id_idx" ON "charges" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "charges_salon_id_status_idx" ON "charges" USING btree ("salon_id","status");