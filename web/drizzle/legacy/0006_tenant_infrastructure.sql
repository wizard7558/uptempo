-- Migration: Tenant Infrastructure
-- Creates the tenants registry and platform_clients tables in the public schema.
-- Does NOT drop the existing salons table (needed for pilot migration in Phase 8).

CREATE TABLE IF NOT EXISTS "tenants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "timezone" text NOT NULL DEFAULT 'America/New_York',
  "stripe_connect_account_id" text,
  "schema_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_unique" ON "tenants" USING btree ("slug");

CREATE TABLE IF NOT EXISTS "platform_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_clients_email_unique" ON "platform_clients" USING btree ("email");
