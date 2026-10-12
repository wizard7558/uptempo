-- Rollback for 0027_assistant_tasks_module (manual).
UPDATE "tenants" SET "modules" = "modules" || '["assistant_tasks"]'::jsonb WHERE "assistant_seats" = 0 AND "industry" = 'hair_salon' AND NOT ("modules" @> '["assistant_tasks"]'::jsonb);
