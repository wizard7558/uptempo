CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_slug" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_token_unique" ON "team_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "team_invitations_email_tenant_idx" ON "team_invitations" USING btree ("email","tenant_slug");--> statement-breakpoint
CREATE INDEX "team_invitations_tenant_status_idx" ON "team_invitations" USING btree ("tenant_slug","status");