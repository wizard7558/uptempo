-- Phase 1.7: assistant tasks are gated by the assistant_tasks module, not tenants.assistant_seats.
-- Keeps today's behavior: businesses with no assistant seats start with the module off.
-- Down: drizzle/rollback/0027_assistant_tasks_module.down.sql
UPDATE "tenants" SET "modules" = "modules" - 'assistant_tasks' WHERE "assistant_seats" = 0 AND "modules" @> '["assistant_tasks"]'::jsonb;
