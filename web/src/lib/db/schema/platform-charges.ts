import {
  pgTable,
  uuid,
  text,
  integer,
  date,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Platform-level ledger of monthly platform-fee charges the platform bills to a
 * salon (tenant). One row per tenant per billing period; the unique
 * (tenant_slug, period_start) index makes the monthly billing cron idempotent.
 *
 * amountChargedCents is the floor top-up actually charged =
 * max(0, floor − feesCollectedCents) (0 when per-transaction application fees
 * already met/exceeded the floor, or the salon is exempt).
 */
export const platformCharges = pgTable(
  "platform_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantSlug: text("tenant_slug").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    floorCents: integer("floor_cents").notNull(),
    feePercent: text("fee_percent"), // stored as text to preserve fractional rates (e.g. "0.5")
    revenueCents: integer("revenue_cents").notNull().default(0),
    feesCollectedCents: integer("fees_collected_cents").notNull().default(0),
    amountChargedCents: integer("amount_charged_cents").notNull().default(0),
    // "succeeded" | "failed" | "skipped" | "no_payment_method" | "pending"
    status: text("status").notNull().default("pending"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("platform_charges_tenant_period_unique").on(
      table.tenantSlug,
      table.periodStart,
    ),
    index("platform_charges_tenant_idx").on(table.tenantSlug),
  ],
);
