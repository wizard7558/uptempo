-- D14: live businesses opt in to gift cards from Settings > Features.
-- Down: drizzle/rollback/0030_gift_cards_module_off.down.sql
UPDATE "tenants" SET "modules" = "modules" - 'gift_cards' WHERE "modules" @> '["gift_cards"]'::jsonb;
