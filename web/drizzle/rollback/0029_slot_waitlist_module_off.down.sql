-- Rollback for 0029_slot_waitlist_module_off (manual).
UPDATE "tenants" SET "modules" = "modules" || '["slot_waitlist"]'::jsonb WHERE "industry" IN ('hair_salon','barber','nail_salon','tattoo','massage_wellness','personal_training','general') AND NOT ("modules" @> '["slot_waitlist"]'::jsonb);
