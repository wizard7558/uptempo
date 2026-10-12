-- Pre-launch app waitlist (`/waitlist`). Platform-level like `quiz_responses`:
-- no tenant, public schema. Email is required and stored lowercased so the
-- unique index dedupes repeat signups; `source` carries the `?src=` label from
-- QR codes and campaign links.
CREATE TABLE IF NOT EXISTS "waitlist_signups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text,
  "email" text NOT NULL,
  "phone" text,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_signups_email_idx" ON "waitlist_signups" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_signups_created_at_idx" ON "waitlist_signups" ("created_at");
