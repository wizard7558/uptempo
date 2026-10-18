-- Rollback for 0032_card_processing_rate (manual).
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_processing_rate_bps_range";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "processing_rate_bps";
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "comped";
-- To let the migration run again (its backfills only run when the columns are
-- added), also remove its journal row:
-- DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791866174995;
