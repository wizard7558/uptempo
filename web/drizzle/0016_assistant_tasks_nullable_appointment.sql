-- assistant_tasks lives in tenant schemas only; this is a no-op against the
-- public schema but keeps the public migration journal in sync. The actual
-- column change is applied per-tenant by tenant migration 0023.
ALTER TABLE IF EXISTS "assistant_tasks" ALTER COLUMN "appointment_id" DROP NOT NULL;
