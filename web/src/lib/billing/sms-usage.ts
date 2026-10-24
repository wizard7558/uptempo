import { and, asc, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { reconcileHostedTextMeter } from "@/lib/billing/hosted-text-lifecycle";
import { TEXTS_METER_EVENT } from "@/lib/billing/hosted-catalog";
import { HOSTED_TEXTS_METERED_LOOKUP_KEY } from "@/lib/billing/hosted-pricing";
import { retrieveHostedSubscriptionInventory } from "@/lib/billing/subscriptions";
import { isSingleMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";
import { hostedTextBillingState, smsUsageReports, tenants } from "@/lib/db/schema";
import { withTenantDb } from "@/lib/db/tenant";
import { getStripe } from "@/lib/stripe/server";

export type SmsUsageResult = {
  reported: string[];
  zero: string[];
  skipped: string[];
  failed: string[];
  /** Paid usage retained as pending: missing/unattributable meter, uncertain, or outside the window. */
  held: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKFILL_DAYS = 30;
/** Conservative bound inside Stripe's 24-hour idempotency and identifier retention. */
const REPORT_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const REPORTABLE_STATUSES = new Set(["active", "past_due", "unpaid"]);

/** Parses a real YYYY-MM-DD date as UTC midnight, or throws. */
function parseUsageDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid usage date "${date}": expected YYYY-MM-DD`);
  }
  const start = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid usage date "${date}": not a real date`);
  }
  return start;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nextDay = (date: string) => isoDay(parseUsageDate(date).getTime() + DAY_MS);
/** The frozen meter event time for a UTC day: its last whole second. */
export const meterEventTimestamp = (date: string) =>
  Math.floor((parseUsageDate(date).getTime() + DAY_MS - 1000) / 1000);

/**
 * Texts to bill for one UTC day (D9): rows sent through Twilio (have a message
 * sid) that did not fail, at or after `notBefore` within that day.
 */
export async function countBilledTexts(
  slug: string,
  date: string,
  options: { notBefore?: Date | null } = {},
): Promise<number> {
  const dayStart = parseUsageDate(date);
  const end = new Date(dayStart.getTime() + DAY_MS);
  const start =
    options.notBefore && options.notBefore.getTime() > dayStart.getTime()
      ? options.notBefore
      : dayStart;
  if (start.getTime() >= end.getTime()) return 0;
  return withTenantDb(slug, async (db, { smsMessages }) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(smsMessages)
      .where(
        and(
          isNotNull(smsMessages.messageSid),
          ne(smsMessages.status, "failed"),
          gte(smsMessages.createdAt, start),
          lt(smsMessages.createdAt, end),
        ),
      );
    return row?.count ?? 0;
  });
}

/** True when the subscription carries the metered texts price. */
export function hasMeteredItem(subscription: Stripe.Subscription): boolean {
  return subscription.items.data.some(
    (item) => item.price?.lookup_key === HOSTED_TEXTS_METERED_LOOKUP_KEY,
  );
}

export type UsageCandidate = {
  slug: string;
  customerId: string;
  subscriptionId: string;
  tenantCustomerId: string | null;
  tenantSubscriptionId: string | null;
  billableFrom: Date;
  nextUsageDate: string;
  lifecycleState: string;
  meterItemId: string | null;
  billingNoticeSentAt: Date | null;
  billingSwitchedAt: Date | null;
};
export type UsageRow = typeof smsUsageReports.$inferSelect;

/** The only DB surface of the reporter; each call is one statement or short transaction. */
export interface UsageReportStore {
  candidates(through: string): Promise<UsageCandidate[]>;
  /** Fresh eligible tenant and lifecycle binding, never a captured candidate. */
  current(slug: string): Promise<UsageCandidate | null>;
  read(slug: string, date: string): Promise<UsageRow | null>;
  /** Insert unless the tenant/date row exists; always returns the committed winner. */
  insert(values: typeof smsUsageReports.$inferInsert): Promise<UsageRow>;
  /** pending/uncertain -> submitted; false when the row was not in either state. */
  markSubmitted(id: string, at: Date): Promise<boolean>;
  /** pending -> uncertain only. */
  markUncertain(id: string): Promise<boolean>;
  /** Move next_usage_date over consecutive submitted days, never past `through`. */
  advanceCursor(slug: string, through: string): Promise<void>;
}

const usageColumns = {
        slug: tenants.slug,
        customerId: hostedTextBillingState.customerId,
        subscriptionId: hostedTextBillingState.subscriptionId,
        tenantCustomerId: tenants.platformStripeCustomerId,
        tenantSubscriptionId: tenants.stripeSubscriptionId,
        billableFrom: hostedTextBillingState.billableFrom,
        nextUsageDate: hostedTextBillingState.nextUsageDate,
        lifecycleState: hostedTextBillingState.lifecycleState,
        meterItemId: hostedTextBillingState.meterItemId,
        billingNoticeSentAt: tenants.billingNoticeSentAt,
        billingSwitchedAt: tenants.billingSwitchedAt,
      };
const eligibleUsage = () => and(eq(tenants.comped, 0), isNotNull(tenants.billingSwitchedAt),
  inArray(tenants.smsLineStatus, ["active", "shared"]), isNotNull(hostedTextBillingState.billableFrom), isNotNull(hostedTextBillingState.nextUsageDate));

export const drizzleUsageReportStore: UsageReportStore = {
  async candidates(through) {
    const rows = await publicDb
      .select(usageColumns)
      .from(hostedTextBillingState)
      .innerJoin(tenants, eq(tenants.slug, hostedTextBillingState.tenantSlug))
      .where(
        and(
          eligibleUsage(),
          lte(hostedTextBillingState.nextUsageDate, through),
        ),
      )
      .orderBy(asc(tenants.slug));
    return rows as UsageCandidate[];
  },
  async current(slug) {
    const [row] = await publicDb.select(usageColumns).from(hostedTextBillingState)
      .innerJoin(tenants, eq(tenants.slug, hostedTextBillingState.tenantSlug))
      .where(and(eligibleUsage(), eq(tenants.slug, slug))).limit(1);
    return (row as UsageCandidate | undefined) ?? null;
  },
  async read(slug, date) {
    const [row] = await publicDb.select().from(smsUsageReports)
      .where(and(eq(smsUsageReports.tenantSlug, slug), eq(smsUsageReports.usageDate, date))).limit(1);
    return row ?? null;
  },
  async insert(values) {
    const [inserted] = await publicDb.insert(smsUsageReports).values(values).onConflictDoNothing().returning();
    const winner = inserted ?? (await this.read(values.tenantSlug, values.usageDate));
    if (!winner) throw new Error("SMS usage report row is unavailable after insert.");
    return winner;
  },
  async markSubmitted(id, at) {
    const rows = await publicDb.update(smsUsageReports).set({ reportStatus: "submitted", reportedAt: at })
      .where(and(eq(smsUsageReports.id, id), inArray(smsUsageReports.reportStatus, ["pending", "uncertain"])))
      .returning({ id: smsUsageReports.id });
    return rows.length === 1;
  },
  async markUncertain(id) {
    const rows = await publicDb.update(smsUsageReports).set({ reportStatus: "uncertain" })
      .where(and(eq(smsUsageReports.id, id), eq(smsUsageReports.reportStatus, "pending")))
      .returning({ id: smsUsageReports.id });
    return rows.length === 1;
  },
  async advanceCursor(slug, through) {
    await publicDb.transaction(async (tx) => {
      const [state] = await tx.select({ nextUsageDate: hostedTextBillingState.nextUsageDate, lifecycleState: hostedTextBillingState.lifecycleState })
        .from(hostedTextBillingState).where(eq(hostedTextBillingState.tenantSlug, slug)).for("update");
      if (!state?.nextUsageDate || state.lifecycleState !== "ready") return;
      const submitted = new Set((await tx.select({ usageDate: smsUsageReports.usageDate }).from(smsUsageReports)
        .where(and(eq(smsUsageReports.tenantSlug, slug), eq(smsUsageReports.reportStatus, "submitted"),
          gte(smsUsageReports.usageDate, state.nextUsageDate), lte(smsUsageReports.usageDate, through))))
        .map((row) => row.usageDate));
      let cursor = state.nextUsageDate;
      while (cursor <= through && submitted.has(cursor)) cursor = nextDay(cursor);
      if (cursor !== state.nextUsageDate) {
        await tx.update(hostedTextBillingState).set({ nextUsageDate: cursor })
          .where(and(eq(hostedTextBillingState.tenantSlug, slug), eq(hostedTextBillingState.nextUsageDate, state.nextUsageDate)));
      }
    });
  },
};

let store: UsageReportStore = drizzleUsageReportStore;

/** Swap the DB surface in unit tests; call with no argument to restore it. */
export function setUsageReportStoreForTests(next?: UsageReportStore): void {
  store = next ?? drizzleUsageReportStore;
}

type TenantOutcome = "reported" | "zero" | "skipped" | "held";

/**
 * Report billed texts for every pending UTC day through `date` (catching up
 * from each business's cursor inside the 30-day window) to the Stripe texts
 * meter. Paid texts start at the persisted provider boundary (and the legacy
 * switch boundary); trial and paused texts are never billed. One business
 * failing never stops the others.
 */
export async function reportSmsUsage(
  date: string,
  options: { now?: Date } = {},
): Promise<SmsUsageResult> {
  const result: SmsUsageResult = { reported: [], zero: [], skipped: [], failed: [], held: [] };
  const through = parseUsageDate(date);
  if (isSingleMode()) return result;
  const now = options.now ?? new Date();
  const todayMs = Date.parse(`${isoDay(now.getTime())}T00:00:00Z`);
  if (through.getTime() >= todayMs) throw new Error(`Invalid usage date "${date}": must be before today (UTC)`);
  const windowStart = isoDay(todayMs - MAX_BACKFILL_DAYS * DAY_MS);

  for (const candidate of await store.candidates(date)) {
    try {
      result[await reportTenant(candidate, date, windowStart, now)].push(candidate.slug);
    } catch {
      console.error("[billing] reportSmsUsage failed", "usage_reporting_failed");
      result.failed.push(candidate.slug);
    }
  }
  return result;
}

/** Match the current row to the captured boundary and any committed winner. */
async function localReadiness(expected: UsageCandidate, row?: UsageRow): Promise<UsageCandidate | null> {
  const current = await store.current(expected.slug);
  if (!current || current.slug !== expected.slug || current.lifecycleState !== "ready" || !current.meterItemId ||
    current.customerId !== current.tenantCustomerId || current.subscriptionId !== current.tenantSubscriptionId ||
    current.customerId !== expected.customerId || current.subscriptionId !== expected.subscriptionId ||
    current.meterItemId !== expected.meterItemId || current.billableFrom.getTime() !== expected.billableFrom.getTime() ||
    current.billingSwitchedAt?.getTime() !== expected.billingSwitchedAt?.getTime() ||
    current.billingNoticeSentAt?.getTime() !== expected.billingNoticeSentAt?.getTime() ||
    (row && (row.tenantSlug !== current.slug || row.customerId !== current.customerId || row.subscriptionId !== current.subscriptionId))) return null;
  return current;
}

/** Every dispatch obtains complete fresh inventory, then rechecks local quarantine/bindings. */
async function meterReadiness(candidate: UsageCandidate, row?: UsageRow): Promise<{ itemCreated: number } | null> {
  if (!(await localReadiness(candidate, row))) return null;
  const subscription = await retrieveHostedSubscriptionInventory(
    candidate.subscriptionId, candidate.slug, candidate.customerId, getStripe());
  if (!REPORTABLE_STATUSES.has(subscription.status)) return null;
  const meters = subscription.items.data.filter((entry) => entry.price?.lookup_key === HOSTED_TEXTS_METERED_LOOKUP_KEY);
  const item = meters[0];
  if (meters.length !== 1 || item?.id !== candidate.meterItemId || !(await localReadiness(candidate, row))) return null;
  return { itemCreated: item.created };
}

async function reportTenant(
  candidate: UsageCandidate,
  through: string,
  windowStart: string,
  now: Date,
): Promise<TenantOutcome> {
  const { slug } = candidate;
  if (candidate.tenantCustomerId !== candidate.customerId || candidate.tenantSubscriptionId !== candidate.subscriptionId) {
    throw new Error("Hosted text billing bindings no longer match the tenant.");
  }
  // Notified legacy tenants wait for the committed switch marker.
  if (candidate.billingNoticeSentAt && !candidate.billingSwitchedAt) return "skipped";
  // A staff/licensed-item sync failure (or a caller that bypasses nightly
  // sync entirely) cannot bypass canonical transition-history validation.
  const lifecycle = await reconcileHostedTextMeter(slug, { now: () => now });
  if (lifecycle.outcome !== "ready" || !(await localReadiness(candidate))) return "held";
  const legacyBoundary = candidate.billingNoticeSentAt ? candidate.billingSwitchedAt : null;
  const notBefore = legacyBoundary && legacyBoundary > candidate.billableFrom ? legacyBoundary : candidate.billableFrom;

  let held = candidate.nextUsageDate < windowStart;
  let reported = false;
  let zero = false;
  try {
    for (let day = held ? windowStart : candidate.nextUsageDate; day <= through; day = nextDay(day)) {
      let row = await store.read(slug, day);
      if (!row) {
        const ready = await meterReadiness(candidate);
        if (!ready) { held = true; continue; }
        const count = await countBilledTexts(slug, day, { notBefore });
        const timestamp = meterEventTimestamp(day);
        if (!(await localReadiness(candidate)) || (count > 0 && ready.itemCreated > timestamp)) {
          held = true;
          continue;
        }
        row = await store.insert(count === 0
          ? { tenantSlug: slug, usageDate: day, quantity: 0, meterEventIdentifier: null, reportStatus: "submitted", reportedAt: now }
          : {
              tenantSlug: slug, usageDate: day, quantity: count, meterEventIdentifier: `${slug}:${day}`,
              reportStatus: "pending", reportedAt: null, customerId: candidate.customerId,
              subscriptionId: candidate.subscriptionId, meterEventTimestamp: timestamp, firstAttemptAt: now,
            });
        if (row.reportStatus === "submitted" && row.meterEventIdentifier == null) {
          zero = true;
          continue;
        }
      }
      if (row.reportStatus === "submitted") continue;
      if (row.reportStatus === "uncertain") {
        held = true;
        continue;
      }
      if (!row.firstAttemptAt || now.getTime() - row.firstAttemptAt.getTime() >= REPORT_RETRY_WINDOW_MS) {
        await store.markUncertain(row.id);
        held = true;
        continue;
      }
      const ready = await meterReadiness(candidate, row);
      if (!ready || row.meterEventTimestamp == null || ready.itemCreated > row.meterEventTimestamp) {
        held = true;
        continue;
      }
      // The winning row's frozen facts, never this worker's recount.
      await getStripe().billing.meterEvents.create(
        {
          event_name: TEXTS_METER_EVENT,
          payload: { stripe_customer_id: row.customerId!, value: String(row.quantity) },
          identifier: row.meterEventIdentifier!,
          timestamp: row.meterEventTimestamp!,
        },
        { idempotencyKey: `hosted-usage-v1:${row.id}`, timeout: 30_000, maxNetworkRetries: 0 },
      );
      if (await store.markSubmitted(row.id, now)) reported = true;
    }
  } finally {
    if (await localReadiness(candidate)) await store.advanceCursor(slug, through);
  }
  return held ? "held" : reported ? "reported" : zero ? "zero" : "skipped";
}
