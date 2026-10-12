-- Platform-level (public schema) prospect/audience quiz responses, collected via
-- the unauthenticated /quiz page. Not tied to any tenant. All answer columns are
-- nullable so respondents can skip questions.
CREATE TABLE IF NOT EXISTS "quiz_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text,
	"current_software" text,
	"biggest_time_waster" text,
	"automate_one_thing" text,
	"software_rating" integer,
	"favorite_thing" text,
	"least_favorite_thing" text,
	"wished_feature" text,
	"contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quiz_responses_created_at_idx" ON "quiz_responses" ("created_at");
