-- Attribution for the /quiz prospect survey. QR codes and campaign links carry
-- a `?src=` label (e.g. "flyer-salon-expo") so the team can tell which placement
-- a response came from. Nullable — direct visits have no source.
ALTER TABLE "quiz_responses" ADD COLUMN IF NOT EXISTS "source" text;
