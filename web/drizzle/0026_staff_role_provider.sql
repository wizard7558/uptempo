-- Phase 1.6: team role value 'stylist' -> 'provider'. Code accepts both during rollout
-- (normalizeTeamRole in src/lib/auth/permissions.ts). Down: drizzle/rollback/0026_staff_role_provider.down.sql
UPDATE "user" SET "role" = 'provider' WHERE "role" = 'stylist';--> statement-breakpoint
UPDATE "memberships" SET "role" = 'provider' WHERE "role" = 'stylist';--> statement-breakpoint
UPDATE "team_invitations" SET "role" = 'provider' WHERE "role" = 'stylist';
