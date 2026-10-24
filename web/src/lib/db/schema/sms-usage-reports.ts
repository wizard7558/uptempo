import { sql } from "drizzle-orm";
import { bigint, check, date, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export type SmsUsageReportStatus = "pending" | "submitted" | "uncertain";

/**
 * One row per business per UTC day. Pending/uncertain rows retain dispatch
 * facts for retries; legacy writers still default to submitted with reported_at.
 * Migration 0038 owns the SQL trigger freezing dispatch facts and submitted rows;
 * Drizzle snapshots do not represent that trigger.
 */
export const smsUsageReports = pgTable(
  "sms_usage_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantSlug: text("tenant_slug").notNull(),
    usageDate: date("usage_date").notNull(),
    quantity: integer("quantity").notNull(),
    meterEventIdentifier: text("meter_event_identifier"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).defaultNow(),
    reportStatus: text("report_status").$type<SmsUsageReportStatus>().notNull().default("submitted"),
    customerId: text("customer_id"),
    subscriptionId: text("subscription_id"),
    meterEventTimestamp: bigint("meter_event_timestamp", { mode: "number" }),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  },
  (table) => [
    unique("sms_usage_reports_tenant_date_unique").on(table.tenantSlug, table.usageDate),
    check("sms_usage_reports_status_check", sql`${table.reportStatus} IN ('pending', 'submitted', 'uncertain')`),
    check("sms_usage_reports_reported_at_check", sql`(${table.reportStatus} = 'submitted' AND ${table.reportedAt} IS NOT NULL) OR (${table.reportStatus} IN ('pending', 'uncertain') AND ${table.reportedAt} IS NULL)`),
    check("sms_usage_reports_dispatch_facts_check", sql`${table.reportStatus} = 'submitted' OR (${table.customerId} IS NOT NULL AND ${table.subscriptionId} IS NOT NULL AND ${table.meterEventIdentifier} IS NOT NULL AND ${table.meterEventTimestamp} IS NOT NULL AND ${table.firstAttemptAt} IS NOT NULL AND ${table.quantity} >= 0 AND ${table.meterEventTimestamp} >= 0)`),
    check("sms_usage_reports_meter_timestamp_check", sql`${table.meterEventTimestamp} IS NULL OR ${table.meterEventTimestamp} >= 0`),
  ],
);
