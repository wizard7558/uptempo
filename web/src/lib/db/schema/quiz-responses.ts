import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Platform-level (public schema) responses to the prospect/audience quiz at
 * `/quiz`. This is a market-research / "know your audience" collector that the
 * team shares as a private link with solo service providers — it is not tied to
 * any tenant. All answer fields are nullable so respondents can skip questions.
 *
 * The contact fields and six questions map to the columns below (see
 * `src/actions/quiz.ts`).
 */
export const quizResponses = pgTable(
  "quiz_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Contact info (optional, so the team can follow up)
    name: text("name"),
    phone: text("phone"),
    email: text("email"),
    // Q1: What wastes the most time in your business?
    biggestTimeWaster: text("biggest_time_waster"),
    // Q2: If you could automate one thing, what would it be?
    automateOneThing: text("automate_one_thing"),
    // Q3: Rate your current software (1–5)
    softwareRating: integer("software_rating"),
    // Q4: What's your favorite thing about it?
    favoriteThing: text("favorite_thing"),
    // Q5: What's your least favorite thing about it?
    leastFavoriteThing: text("least_favorite_thing"),
    // Q6: If you could have any additional feature, what would it be?
    wishedFeature: text("wished_feature"),
    // Attribution label from `?src=` (QR code, campaign link). Null if absent.
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("quiz_responses_created_at_idx").on(table.createdAt)],
);
