import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Platform-level (public schema) signups for the pre-launch app waitlist at
 * `/waitlist`. Like `quiz_responses` this is not tied to any tenant — it is a
 * plain list of prospects who want to hear when the app opens up.
 *
 * `email` is the only required field and is stored lowercased so the unique
 * index dedupes repeat signups (see `src/actions/waitlist.ts`). `source` holds
 * the `?src=` label carried by QR codes and campaign links so the team can tell
 * which placement a signup came from.
 */
export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    email: text("email").notNull(),
    phone: text("phone"),
    // Attribution label from `?src=` (QR code, campaign link). Null if absent.
    source: text("source"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("waitlist_signups_email_idx").on(table.email),
    index("waitlist_signups_created_at_idx").on(table.createdAt),
  ],
);
