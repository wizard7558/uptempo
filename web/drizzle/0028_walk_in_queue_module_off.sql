-- Phase 3.5 (D14): live businesses opt in to the walk-in line from Settings > Features.
-- Down: drizzle/rollback/0028_walk_in_queue_module_off.down.sql
UPDATE "tenants" SET "modules" = "modules" - 'walk_in_queue' WHERE "modules" @> '["walk_in_queue"]'::jsonb;
