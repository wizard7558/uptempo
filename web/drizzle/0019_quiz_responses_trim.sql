-- Narrow quiz_responses to the final six survey questions. The role,
-- current_software, and contact columns from 0018 are unused by the form and
-- held no data, so drop them to keep the schema aligned with the questions.
ALTER TABLE "quiz_responses" DROP COLUMN IF EXISTS "role";
--> statement-breakpoint
ALTER TABLE "quiz_responses" DROP COLUMN IF EXISTS "current_software";
--> statement-breakpoint
ALTER TABLE "quiz_responses" DROP COLUMN IF EXISTS "contact";
