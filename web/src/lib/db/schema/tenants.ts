import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  jsonb,
  check,
} from "drizzle-orm/pg-core";

export type SmsLineStatus =
  | "off"
  | "shared"
  | "pending"
  | "action_needed"
  | "active";

/** Sanitized, resumable registration data. The full EIN is never persisted. */
export interface SmsRegistrationState {
  version?: 1;
  status?: "collecting" | "submitted" | "action_needed" | "active";
  brandType?: "STANDARD" | "SOLE_PROPRIETOR";
  step?: string;
  input?: Record<string, string>;
  einLast4?: string;
  reason?: "confirm_text" | "business_rejected" | "registration_failed";
  reasonMessage?: string;
  confirmationSentAt?: string;
  startedFromShared?: boolean;
  setupFeeEligible?: boolean;
  setupFeeWaived?: boolean;
  setupFeeState?: "waived" | "added";
  setupFeeInvoiceItemId?: string;
  setupFeeLease?: { token: string; expiresAt: string };
  submittedAt?: string;
  lastErrorAt?: string;
  lease?: { token: string; expiresAt: string };
  resources?: Record<string, string>;
}

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
    comped: integer("comped").notNull().default(0),
    processingRateBps: integer("processing_rate_bps"),
    // Paid platform billing (max($50 floor, fee% x revenue)). Off by default so
    // beta salons stay free; flipped on per salon when they move to paid.
    billingEnabled: integer("billing_enabled").notNull().default(0),
    // Stripe Customer + default card on the PLATFORM account used to charge the
    // salon its monthly platform fee (distinct from their Connect payout account
    // and from client cards).
    platformStripeCustomerId: text("platform_stripe_customer_id"),
    platformPaymentMethodId: text("platform_payment_method_id"),
    // Hosted plan subscription on the PLATFORM account (Phase 6.1b). Status
    // mirrors Stripe; billable_staff is the last synced staff count.
    stripeSubscriptionId: text("stripe_subscription_id"),
    subscriptionStatus: text("subscription_status"),
    billableStaff: integer("billable_staff").notNull().default(0),
    // Phase 6.5 migration: only newly created tenants default to already being
    // on the current price. Existing tenants remain null until their switch.
    billingNoticeSentAt: timestamp("billing_notice_sent_at", {
      withTimezone: true,
    }),
    billingSwitchAt: timestamp("billing_switch_at", { withTimezone: true }),
    // Immutable digest of the prepared notice payload. Retries must reuse the
    // same body, recipients, switch date, and provider idempotency key.
    billingNoticePayloadHash: text("billing_notice_payload_hash"),
    billingSwitchedAt: timestamp("billing_switched_at", {
      withTimezone: true,
    }).defaultNow(),
    // Opt-in: list this salon in the public client app marketplace (default off).
    listedInMarketplace: integer("listed_in_marketplace").notNull().default(0),
    // Industry pack id (see src/lib/verticals). Unknown values resolve to "general".
    industry: text("industry").notNull().default("hair_salon"),
    // Enabled ModuleId strings (JSON array); drives which feature modules are on.
    modules: jsonb("modules").$type<string[]>().notNull().default([]),
    smsLineStatus: text("sms_line_status")
      .$type<SmsLineStatus>()
      .notNull()
      .default("off"),
    smsBrandId: text("sms_brand_id"),
    smsCampaignId: text("sms_campaign_id"),
    smsMessagingServiceSid: text("sms_messaging_service_sid"),
    smsPhoneNumber: text("sms_phone_number"),
    smsRegistration: jsonb("sms_registration")
      .$type<SmsRegistrationState>()
      .notNull()
      .default({}),
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
    uniqueIndex("tenants_stripe_subscription_unique")
      .on(table.stripeSubscriptionId)
      .where(sql`${table.stripeSubscriptionId} IS NOT NULL`),
    check(
      "tenants_processing_rate_bps_range",
      sql`${table.processingRateBps} IS NULL OR (${table.processingRateBps} >= 0 AND ${table.processingRateBps} <= 1000)`,
    ),
    check(
      "tenants_sms_line_status_check",
      sql`${table.smsLineStatus} IN ('off', 'shared', 'pending', 'action_needed', 'active')`,
    ),
  ],
);
