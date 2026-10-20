import { date, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * One row per business per UTC day once that day's billed texts have been
 * reported to the Stripe texts meter (Phase 6.1d). The unique key makes the
 * nightly report idempotent; `meter_event_identifier` is null when nothing was sent.
 */
export const smsUsageReports = pgTable(
  "sms_usage_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantSlug: text("tenant_slug").notNull(),
    usageDate: date("usage_date").notNull(),
    quantity: integer("quantity").notNull(),
    meterEventIdentifier: text("meter_event_identifier"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("sms_usage_reports_tenant_date_unique").on(table.tenantSlug, table.usageDate)],
);
