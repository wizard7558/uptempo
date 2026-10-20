-- Manual rollback. Restores the plan defaults from 0032 for every business
-- except salon-emme, which this migration did not change.
UPDATE "tenants"
SET "processing_rate_bps" = LEAST(1000, COALESCE(
  "platform_fee_percent" * 100,
  CASE "plan" WHEN 'starter' THEN 50 WHEN 'pro' THEN 100 WHEN 'business' THEN 200 ELSE 0 END
))
WHERE "slug" <> 'salon-emme';
