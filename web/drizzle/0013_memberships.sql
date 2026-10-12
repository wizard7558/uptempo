-- Memberships: one row per (user, tenant) with role; enables same email in multiple salons.

CREATE TABLE IF NOT EXISTS "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"tenant_slug" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_user_tenant_unique" ON "memberships" USING btree ("user_id","tenant_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_tenant_idx" ON "memberships" USING btree ("tenant_slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_idx" ON "memberships" USING btree ("user_id");
--> statement-breakpoint
INSERT INTO "memberships" ("user_id", "tenant_slug", "role", "created_at", "updated_at")
SELECT "id", "tenant_slug", "role", "created_at", "updated_at"
FROM "user"
WHERE "tenant_slug" IS NOT NULL AND "role" <> 'client';
