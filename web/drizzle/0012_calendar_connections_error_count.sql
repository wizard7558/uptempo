ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "error_count" integer DEFAULT 0 NOT NULL;
