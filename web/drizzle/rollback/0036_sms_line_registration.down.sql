ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_sms_line_status_check";
ALTER TABLE "tenants"
  DROP COLUMN IF EXISTS "sms_registration",
  DROP COLUMN IF EXISTS "sms_phone_number",
  DROP COLUMN IF EXISTS "sms_messaging_service_sid",
  DROP COLUMN IF EXISTS "sms_campaign_id",
  DROP COLUMN IF EXISTS "sms_brand_id",
  DROP COLUMN IF EXISTS "sms_line_status";
