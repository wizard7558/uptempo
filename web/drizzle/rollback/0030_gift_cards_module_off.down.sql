-- Rollback for 0030_gift_cards_module_off (manual).
-- personal_training does not include gift cards in its pack.
UPDATE "tenants" SET "modules" = "modules" || '["gift_cards"]'::jsonb WHERE "industry" IN ('hair_salon','barber','nail_salon','tattoo','massage_wellness','general') AND NOT ("modules" @> '["gift_cards"]'::jsonb);
