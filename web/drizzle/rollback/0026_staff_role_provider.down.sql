-- Rollback for 0026_staff_role_provider. Applied only by scripts/rollback-0040.ts.
UPDATE "user" SET "role" = 'stylist' WHERE "role" = 'provider';--> statement-breakpoint
UPDATE "memberships" SET "role" = 'stylist' WHERE "role" = 'provider';--> statement-breakpoint
UPDATE "team_invitations" SET "role" = 'stylist' WHERE "role" = 'provider';
