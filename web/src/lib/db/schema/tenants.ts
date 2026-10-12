import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("active"), // active, suspended, deactivated
    timezone: text("timezone").notNull().default("America/New_York"),
    stripeConnectAccountId: text("stripe_connect_account_id"),
    schemaVersion: integer("schema_version").notNull().default(1),
    onboardingSteps: jsonb("onboarding_steps").default({}).notNull(),
    // FROZEN (Phase 1.7): read only by billing; dropped in Phase 6.
    plan: text("plan").notNull().default("starter"), // starter, pro, business
    platformFeePercent: integer("platform_fee_percent"), // null = use plan default; 0 = exempt
    // Paid platform billing (max($50 floor, fee% x revenue)). Off by default so
    // beta salons stay free; flipped on per salon when they move to paid.
    billingEnabled: integer("billing_enabled").notNull().default(0),
    // Stripe Customer + default card on the PLATFORM account used to charge the
    // salon its monthly platform fee (distinct from their Connect payout account
    // and from client cards).
    platformStripeCustomerId: text("platform_stripe_customer_id"),
    platformPaymentMethodId: text("platform_payment_method_id"),
    // Opt-in: list this salon in the public client app marketplace (default off).
    listedInMarketplace: integer("listed_in_marketplace").notNull().default(0),
    // Industry pack id (see src/lib/verticals). Unknown values resolve to "general".
    industry: text("industry").notNull().default("hair_salon"),
    // Enabled ModuleId strings (JSON array); drives which feature modules are on.
    modules: jsonb("modules").$type<string[]>().notNull().default([]),
    // Partial VerticalTerms overrides merged over the pack's terminology.
    terminology: jsonb("terminology")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Which database shard holds this tenant's schema.
    dbShard: text("db_shard").notNull().default("primary"),
    // FROZEN (Phase 1.7): unused; gating moved to modules.assistant_tasks. Dropped in Phase 6.
    assistantSeats: integer("assistant_seats").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("tenants_slug_unique").on(table.slug),
    uniqueIndex("tenants_stripe_connect_account_unique").on(
      table.stripeConnectAccountId,
    ),
  ],
);
