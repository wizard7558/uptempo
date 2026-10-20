-- Rollback for 0033_hosted_subscription (manual).
DROP INDEX IF EXISTS "tenants_stripe_subscription_unique";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "billable_staff";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "subscription_status";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "stripe_subscription_id";
