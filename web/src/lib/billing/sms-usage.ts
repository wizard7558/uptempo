import { and, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { TEXTS_METER_EVENT } from "@/lib/billing/hosted-catalog";
import { HOSTED_TEXTS_METERED_LOOKUP_KEY } from "@/lib/billing/hosted-pricing";
import { isSingleMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";
import { smsUsageReports, tenants } from "@/lib/db/schema";
import { withTenantDb } from "@/lib/db/tenant";
import { getStripe } from "@/lib/stripe/server";

export type SmsUsageResult = {
  reported: string[];
  zero: string[];
  skipped: string[];
  failed: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * Texts to bill for one UTC day (D9): rows sent through Twilio (have a message
 * sid) that did not fail.
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

/**
 * Report one UTC day's billed texts to the Stripe texts meter for every paying
 * hosted business. Idempotent per (business, day): a stored report row skips
 * the business, and the meter event identifier guards a retry. One business
 * failing never stops the others.
 */
export async function reportSmsUsage(date: string): Promise<SmsUsageResult> {
  const result: SmsUsageResult = { reported: [], zero: [], skipped: [], failed: [] };
  const start = parseUsageDate(date);
  if (isSingleMode()) return result;

  const candidates = await publicDb
    .select({
      slug: tenants.slug,
      subscriptionId: tenants.stripeSubscriptionId,
      customerId: tenants.platformStripeCustomerId,
      billingNoticeSentAt: tenants.billingNoticeSentAt,
      billingSwitchedAt: tenants.billingSwitchedAt,
    })
    .from(tenants)
    .where(
      and(
        eq(tenants.comped, 0),
        isNotNull(tenants.stripeSubscriptionId),
        isNotNull(tenants.platformStripeCustomerId),
      ),
    );

  for (const {
    slug,
    subscriptionId,
    customerId,
    billingNoticeSentAt,
    billingSwitchedAt,
  } of candidates) {
    try {
      const [existing] = await publicDb
        .select({ id: smsUsageReports.id })
        .from(smsUsageReports)
        .where(and(eq(smsUsageReports.tenantSlug, slug), eq(smsUsageReports.usageDate, date)))
        .limit(1);
      if (existing) {
        result.skipped.push(slug);
        continue;
      }
      // During a hosted switch Stripe may already accept the text meter item
      // while the public transaction still correctly has no final switch
      // marker. Do not count the unbounded legacy day in that window.
      if (billingNoticeSentAt && !billingSwitchedAt) {
        result.skipped.push(slug);
        continue;
      }

      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(subscriptionId!, {
        expand: ["items.data.price"],
      });
      if (!hasMeteredItem(subscription)) {
        result.skipped.push(slug);
        continue;
      }

      const count = await countBilledTexts(slug, date, {
        notBefore:
          billingNoticeSentAt && billingSwitchedAt ? billingSwitchedAt : null,
      });
      if (count === 0) {
        await publicDb
          .insert(smsUsageReports)
          .values({ tenantSlug: slug, usageDate: date, quantity: 0, meterEventIdentifier: null })
          .onConflictDoNothing();
        result.zero.push(slug);
        continue;
      }

      const identifier = `${slug}:${date}`;
      await stripe.billing.meterEvents.create({
        event_name: TEXTS_METER_EVENT,
        payload: { stripe_customer_id: customerId!, value: String(count) },
        identifier,
        timestamp: Math.floor((start.getTime() + DAY_MS - 1000) / 1000),
      });
      await publicDb
        .insert(smsUsageReports)
        .values({
          tenantSlug: slug,
          usageDate: date,
          quantity: count,
          meterEventIdentifier: identifier,
        })
        .onConflictDoNothing();
      result.reported.push(slug);
    } catch (error) {
      console.error("[billing] reportSmsUsage failed", slug, date, error);
      result.failed.push(slug);
    }
  }
  return result;
}
