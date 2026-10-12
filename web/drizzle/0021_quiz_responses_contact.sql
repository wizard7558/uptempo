-- Add optional contact info (name, phone, email) to the /quiz prospect survey
-- so the team can follow up with respondents. Nullable like every other answer
-- column — respondents can still submit anonymously.
ALTER TABLE "quiz_responses" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
ALTER TABLE "quiz_responses" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
ALTER TABLE "quiz_responses" ADD COLUMN IF NOT EXISTS "email" text;
