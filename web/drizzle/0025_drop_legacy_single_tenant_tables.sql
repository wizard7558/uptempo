-- Drop the pre-multi-tenant ("legacy single-tenant") tables from the public schema.
-- All salon data now lives in per-tenant schemas (tenant_<slug>); the app no longer
-- reads or writes these public tables.
--
-- SAFETY: each table is dropped only if it does not exist or is empty. If any legacy
-- table still holds rows the migration raises and the whole run rolls back, so no
-- data is ever dropped silently. Back up and clear such rows deliberately first.
-- Drops are ordered children-first to respect foreign keys. `locations` was defined
-- in TS but never created by any migration, so its drop is a no-op.
--
-- drizzle-kit housekeeping: snapshots 0011-0023 were never written because 0011-0024
-- were hand-authored SQL. drizzle/meta/0024_snapshot.json was rebuilt from the TS
-- schema as it stood before this change (drizzle-kit/api generateDrizzleJson, chained
-- to 0010's id) so `drizzle-kit generate` diffs against reality without interactive
-- rename prompts. 0025_snapshot.json is the post-drop schema.

DO $$
BEGIN
  IF to_regclass('public.external_events') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."external_events" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.external_events: table is not empty';
    END IF;
    DROP TABLE public."external_events" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.calendar_connections') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."calendar_connections" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.calendar_connections: table is not empty';
    END IF;
    DROP TABLE public."calendar_connections" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.charges') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."charges" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.charges: table is not empty';
    END IF;
    DROP TABLE public."charges" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.appointment_services') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."appointment_services" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.appointment_services: table is not empty';
    END IF;
    DROP TABLE public."appointment_services" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.client_service_overrides') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."client_service_overrides" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.client_service_overrides: table is not empty';
    END IF;
    DROP TABLE public."client_service_overrides" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.stylist_services') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."stylist_services" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.stylist_services: table is not empty';
    END IF;
    DROP TABLE public."stylist_services" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.working_hours') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."working_hours" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.working_hours: table is not empty';
    END IF;
    DROP TABLE public."working_hours" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.appointments') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."appointments" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.appointments: table is not empty';
    END IF;
    DROP TABLE public."appointments" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.booking_verifications') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."booking_verifications" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.booking_verifications: table is not empty';
    END IF;
    DROP TABLE public."booking_verifications" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.salon_policies') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."salon_policies" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.salon_policies: table is not empty';
    END IF;
    DROP TABLE public."salon_policies" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.salons') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."salons" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.salons: table is not empty';
    END IF;
    DROP TABLE public."salons" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."clients" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.clients: table is not empty';
    END IF;
    DROP TABLE public."clients" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.stylists') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."stylists" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.stylists: table is not empty';
    END IF;
    DROP TABLE public."stylists" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.services') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."services" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.services: table is not empty';
    END IF;
    DROP TABLE public."services" CASCADE;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.locations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public."locations" LIMIT 1) THEN
      RAISE EXCEPTION 'Refusing to drop public.locations: table is not empty';
    END IF;
    DROP TABLE public."locations" CASCADE;
  END IF;
END
$$;
