-- Rollback for 0028_walk_in_queue_module_off (manual).
UPDATE "tenants" SET "modules" = "modules" || '["walk_in_queue"]'::jsonb WHERE "industry" IN ('barber','nail_salon') AND NOT ("modules" @> '["walk_in_queue"]'::jsonb);
