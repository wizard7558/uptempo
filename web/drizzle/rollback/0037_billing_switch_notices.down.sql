ALTER TABLE "tenants"
  DROP COLUMN IF EXISTS "billing_switched_at",
  DROP COLUMN IF EXISTS "billing_notice_payload_hash",
  DROP COLUMN IF EXISTS "billing_switch_at",
  DROP COLUMN IF EXISTS "billing_notice_sent_at";
