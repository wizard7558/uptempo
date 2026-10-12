-- Phase 3.5 (D14): live businesses opt in to the slot waitlist from Settings > Features.
-- Down: drizzle/rollback/0029_slot_waitlist_module_off.down.sql
UPDATE "tenants" SET "modules" = "modules" - 'slot_waitlist' WHERE "modules" @> '["slot_waitlist"]'::jsonb;
