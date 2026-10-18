-- Every hosted business except salon-emme stores the 5% card rate.
-- salon-emme is excluded. Its Stripe Connect account is live, so this
-- migration does not change that row. Safe to run twice.
UPDATE "tenants"
SET "processing_rate_bps" = 500
WHERE "slug" <> 'salon-emme'
  AND "processing_rate_bps" IS DISTINCT FROM 500;
