-- Execute as one statement: the guard, locks, and drops must remain atomic.
DO $rollback$
BEGIN
  LOCK TABLE public.hosted_text_billing_state, public.sms_usage_reports IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.hosted_text_billing_state)
    OR EXISTS (
      SELECT 1 FROM public.sms_usage_reports
      WHERE report_status <> 'submitted'
        OR customer_id IS NOT NULL
        OR subscription_id IS NOT NULL
        OR meter_event_timestamp IS NOT NULL
        OR first_attempt_at IS NOT NULL
        OR reported_at IS NULL
    ) THEN
    RAISE EXCEPTION '0038 rollback refused: hosted text lifecycle or dispatch facts exist';
  END IF;

  DROP TRIGGER hosted_text_preserve_report_facts ON public.sms_usage_reports;
  DROP FUNCTION public.hosted_text_preserve_report_facts();
  ALTER TABLE public.sms_usage_reports
    DROP CONSTRAINT sms_usage_reports_status_check,
    DROP CONSTRAINT sms_usage_reports_reported_at_check,
    DROP CONSTRAINT sms_usage_reports_dispatch_facts_check,
    DROP CONSTRAINT sms_usage_reports_meter_timestamp_check,
    DROP COLUMN report_status,
    DROP COLUMN customer_id,
    DROP COLUMN subscription_id,
    DROP COLUMN meter_event_timestamp,
    DROP COLUMN first_attempt_at,
    ALTER COLUMN reported_at SET NOT NULL;
  DROP TABLE public.hosted_text_billing_state;
END
$rollback$;
