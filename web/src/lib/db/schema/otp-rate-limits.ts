import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const otpRateLimits = pgTable(
  "otp_rate_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantSlug: text("tenant_slug").notNull(),
    scope: text("scope").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("otp_rate_limits_scope_key_unique").on(
      table.tenantSlug,
      table.scope,
      table.normalizedKey,
    ),
    index("otp_rate_limits_updated_at_idx").on(table.updatedAt),
  ],
);
