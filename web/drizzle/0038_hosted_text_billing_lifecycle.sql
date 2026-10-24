CREATE TABLE "hosted_text_billing_state" (
	"tenant_slug" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"billable_from" timestamp with time zone,
	"boundary_kind" text,
	"boundary_event_id" text,
	"meter_item_id" text,
	"meter_operation_id" text,
	"next_usage_date" date,
	"lifecycle_state" text DEFAULT 'unresolved' NOT NULL,
	CONSTRAINT "hosted_text_billing_state_customer_id_unique" UNIQUE("customer_id"),
	CONSTRAINT "hosted_text_billing_state_subscription_id_unique" UNIQUE("subscription_id"),
	CONSTRAINT "hosted_text_billing_state_boundary_event_id_unique" UNIQUE("boundary_event_id"),
	CONSTRAINT "hosted_text_billing_state_meter_item_id_unique" UNIQUE("meter_item_id"),
	CONSTRAINT "hosted_text_billing_state_meter_operation_id_unique" UNIQUE("meter_operation_id"),
	CONSTRAINT "hosted_text_boundary_kind_check" CHECK ("hosted_text_billing_state"."boundary_kind" IN ('trial_end', 'resumed', 'created')),
	CONSTRAINT "hosted_text_boundary_pair_check" CHECK (("hosted_text_billing_state"."billable_from" IS NULL) = ("hosted_text_billing_state"."boundary_kind" IS NULL)),
	CONSTRAINT "hosted_text_lifecycle_state_check" CHECK ("hosted_text_billing_state"."lifecycle_state" IN ('unresolved', 'free', 'activating', 'ready', 'uncertain', 'stopped')),
	CONSTRAINT "hosted_text_ready_check" CHECK ("hosted_text_billing_state"."lifecycle_state" <> 'ready' OR ("hosted_text_billing_state"."billable_from" IS NOT NULL AND "hosted_text_billing_state"."meter_item_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ALTER COLUMN "reported_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD COLUMN "report_status" text DEFAULT 'submitted' NOT NULL;--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD COLUMN "customer_id" text;--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD COLUMN "subscription_id" text;--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD COLUMN "meter_event_timestamp" bigint;--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hosted_text_billing_state" ADD CONSTRAINT "hosted_text_billing_state_tenant_slug_tenants_slug_fk" FOREIGN KEY ("tenant_slug") REFERENCES "public"."tenants"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD CONSTRAINT "sms_usage_reports_status_check" CHECK ("sms_usage_reports"."report_status" IN ('pending', 'submitted', 'uncertain'));--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD CONSTRAINT "sms_usage_reports_reported_at_check" CHECK (("sms_usage_reports"."report_status" = 'submitted' AND "sms_usage_reports"."reported_at" IS NOT NULL) OR ("sms_usage_reports"."report_status" IN ('pending', 'uncertain') AND "sms_usage_reports"."reported_at" IS NULL));--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD CONSTRAINT "sms_usage_reports_dispatch_facts_check" CHECK ("sms_usage_reports"."report_status" = 'submitted' OR ("sms_usage_reports"."customer_id" IS NOT NULL AND "sms_usage_reports"."subscription_id" IS NOT NULL AND "sms_usage_reports"."meter_event_identifier" IS NOT NULL AND "sms_usage_reports"."meter_event_timestamp" IS NOT NULL AND "sms_usage_reports"."first_attempt_at" IS NOT NULL AND "sms_usage_reports"."quantity" >= 0 AND "sms_usage_reports"."meter_event_timestamp" >= 0));--> statement-breakpoint
ALTER TABLE "sms_usage_reports" ADD CONSTRAINT "sms_usage_reports_meter_timestamp_check" CHECK ("sms_usage_reports"."meter_event_timestamp" IS NULL OR "sms_usage_reports"."meter_event_timestamp" >= 0);
--> statement-breakpoint
-- SQL-owned immutability objects are intentionally outside Drizzle snapshots.
CREATE FUNCTION public.hosted_text_preserve_report_facts() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $facts$
BEGIN
  IF OLD.report_status = 'submitted' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'submitted SMS usage reports are immutable' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW.id, NEW.tenant_slug, NEW.usage_date, NEW.quantity,
      NEW.meter_event_identifier, NEW.customer_id, NEW.subscription_id,
      NEW.meter_event_timestamp, NEW.first_attempt_at)
    IS DISTINCT FROM
    ROW(OLD.id, OLD.tenant_slug, OLD.usage_date, OLD.quantity,
      OLD.meter_event_identifier, OLD.customer_id, OLD.subscription_id,
      OLD.meter_event_timestamp, OLD.first_attempt_at) THEN
    RAISE EXCEPTION 'SMS usage dispatch facts are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$facts$;
--> statement-breakpoint
CREATE TRIGGER hosted_text_preserve_report_facts
BEFORE UPDATE ON public.sms_usage_reports
FOR EACH ROW EXECUTE FUNCTION public.hosted_text_preserve_report_facts();
