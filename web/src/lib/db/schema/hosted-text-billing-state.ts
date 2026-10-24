import { sql } from "drizzle-orm";
import { check, date, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export type HostedTextBoundaryKind = "trial_end" | "resumed" | "created";
export type HostedTextLifecycleState =
  | "unresolved"
  | "free"
  | "activating"
  | "ready"
  | "uncertain"
  | "stopped";

/** Provider-confirmed activation facts; a missing boundary must never be inferred. */
export const hostedTextBillingState = pgTable(
  "hosted_text_billing_state",
  {
    tenantSlug: text("tenant_slug").primaryKey().references(() => tenants.slug, { onDelete: "restrict" }),
    customerId: text("customer_id").notNull().unique(),
    subscriptionId: text("subscription_id").notNull().unique(),
    billableFrom: timestamp("billable_from", { withTimezone: true }),
    boundaryKind: text("boundary_kind").$type<HostedTextBoundaryKind>(),
    boundaryEventId: text("boundary_event_id").unique(),
    meterItemId: text("meter_item_id").unique(),
    meterOperationId: text("meter_operation_id").unique(),
    nextUsageDate: date("next_usage_date"),
    lifecycleState: text("lifecycle_state").$type<HostedTextLifecycleState>().notNull().default("unresolved"),
  },
  (table) => [
    check("hosted_text_boundary_kind_check", sql`${table.boundaryKind} IN ('trial_end', 'resumed', 'created')`),
    check("hosted_text_boundary_pair_check", sql`(${table.billableFrom} IS NULL) = (${table.boundaryKind} IS NULL)`),
    check("hosted_text_lifecycle_state_check", sql`${table.lifecycleState} IN ('unresolved', 'free', 'activating', 'ready', 'uncertain', 'stopped')`),
    check("hosted_text_ready_check", sql`${table.lifecycleState} <> 'ready' OR (${table.billableFrom} IS NOT NULL AND ${table.meterItemId} IS NOT NULL)`),
  ],
);
