-- Opt-in flag controlling whether a salon appears in the public client app
-- marketplace/discovery screen. Default 0 (not listed) for all existing tenants.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "listed_in_marketplace" integer DEFAULT 0 NOT NULL;
