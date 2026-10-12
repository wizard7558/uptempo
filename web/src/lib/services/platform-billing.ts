import { and, eq, sql } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { platformCharges } from "@/lib/db/schema";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getStripe } from "@/lib/stripe/server";
import {
  computeMonthlyBilling,
  feePercentForTenant,
} from "@/lib/billing/platform-pricing";

/**
 * Platform-billing orchestration (used by the monthly billing cron). Kept out of
 * the "use server" actions file so it can export sync helpers and be imported by
 * the cron route + unit tests.
 */

/** Previous whole calendar month as [start, end) in UTC. */
export function previousMonthPeriod(now: Date): { start: Date; end: Date } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  return { start, end };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface BillTenantResult {
  slug: string;
  status:
    | "succeeded"
    | "failed"
    | "skipped"
    | "no_payment_method"
    | "already_charged"
    | "not_enabled";
  amountChargedCents: number;
  reason?: string;
}

/**
 * Reconcile and, if needed, charge one tenant's platform fee for a billing
 * period. Idempotent per (tenant, period) via the platform_charges unique index
 * and a Stripe idempotency key. Charges the floor top-up (max(0, floor − fees
 * already collected via application_fee)) to the salon's saved platform card —
 * the charge stays with the platform (no Connect transfer).
 */
export async function billTenantForPeriod(
  slug: string,
  period: { start: Date; end: Date },
  now: Date = new Date(),
): Promise<BillTenantResult> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant || tenant.billingEnabled !== 1) {
    return { slug, status: "not_enabled", amountChargedCents: 0 };
  }

  const periodStart = ymd(period.start);
  const periodEnd = ymd(period.end);

  // Already billed this period? (succeeded/skipped are terminal)
  const [existing] = await publicDb
    .select({
      status: platformCharges.status,
      amountChargedCents: platformCharges.amountChargedCents,
    })
    .from(platformCharges)
    .where(
      and(
        eq(platformCharges.tenantSlug, slug),
        eq(platformCharges.periodStart, periodStart),
      ),
    )
    .limit(1);
  if (
    existing &&
    (existing.status === "succeeded" || existing.status === "skipped")
  ) {
    return {
      slug,
      status: "already_charged",
      amountChargedCents: existing.amountChargedCents,
    };
  }

  // Platform fees already collected (application_fee on appointment charges +
  // storefront orders) and revenue (services + retail) this period.
  const { feesCollectedCents, revenueCents } = await withTenantDb(
    slug,
    async (db, t) => {
      const [fees] = await db
        .select({
          cents: sql<number>`coalesce(sum(coalesce(${t.charges.platformFeeCents}, 0)), 0)::int`,
        })
        .from(t.charges)
        .where(
          and(
            eq(t.charges.status, "completed"),
            sql`${t.charges.createdAt} >= ${period.start.toISOString()}`,
            sql`${t.charges.createdAt} < ${period.end.toISOString()}`,
          ),
        );
      const [rev] = await db
        .select({
          cents: sql<number>`coalesce(sum(coalesce(${t.appointmentServices.priceChargedCents}, ${t.services.priceCents}, 0)), 0)::int`,
        })
        .from(t.appointmentServices)
        .innerJoin(
          t.appointments,
          eq(t.appointmentServices.appointmentId, t.appointments.id),
        )
        .innerJoin(
          t.services,
          eq(t.appointmentServices.serviceId, t.services.id),
        )
        .where(
          and(
            eq(t.appointments.status, "completed"),
            sql`lower(${t.appointments.during}) >= ${period.start.toISOString()}`,
            sql`lower(${t.appointments.during}) < ${period.end.toISOString()}`,
          ),
        );
      const [retail] = await db
        .select({
          fees: sql<number>`coalesce(sum(${t.orders.platformFeeCents}), 0)::int`,
          subtotal: sql<number>`coalesce(sum(${t.orders.subtotalCents}), 0)::int`,
        })
        .from(t.orders)
        .where(
          and(
            sql`${t.orders.status} <> 'refunded'`,
            sql`${t.orders.createdAt} >= ${period.start.toISOString()}`,
            sql`${t.orders.createdAt} < ${period.end.toISOString()}`,
          ),
        );
      return {
        feesCollectedCents:
          Number(fees?.cents ?? 0) + Number(retail?.fees ?? 0),
        revenueCents: Number(rev?.cents ?? 0) + Number(retail?.subtotal ?? 0),
      };
    },
  );

  const feePercent = feePercentForTenant(tenant);
  const billing = computeMonthlyBilling({ feePercent, feesCollectedCents });

  const baseRow = {
    tenantSlug: slug,
    periodStart,
    periodEnd,
    floorCents: billing.floorCents,
    feePercent: String(feePercent),
    revenueCents,
    feesCollectedCents,
    updatedAt: now,
  };

  async function record(
    status: string,
    amountChargedCents: number,
    extra: {
      stripePaymentIntentId?: string | null;
      failureReason?: string | null;
    } = {},
  ) {
    await publicDb
      .insert(platformCharges)
      .values({
        ...baseRow,
        amountChargedCents,
        status,
        stripePaymentIntentId: extra.stripePaymentIntentId ?? null,
        failureReason: extra.failureReason ?? null,
      })
      .onConflictDoUpdate({
        target: [platformCharges.tenantSlug, platformCharges.periodStart],
        set: {
          ...baseRow,
          amountChargedCents,
          status,
          stripePaymentIntentId: extra.stripePaymentIntentId ?? null,
          failureReason: extra.failureReason ?? null,
        },
      });
  }

  // Nothing to charge (exempt, or the percentage already met the floor).
  if (billing.amountToChargeCents <= 0) {
    await record("skipped", 0);
    return { slug, status: "skipped", amountChargedCents: 0 };
  }

  if (!tenant.platformStripeCustomerId || !tenant.platformPaymentMethodId) {
    await record("no_payment_method", 0, {
      failureReason: "No card on file for platform billing",
    });
    return { slug, status: "no_payment_method", amountChargedCents: 0 };
  }

  try {
    const paymentIntent = await getStripe().paymentIntents.create(
      {
        amount: billing.amountToChargeCents,
        currency: "usd",
        customer: tenant.platformStripeCustomerId,
        payment_method: tenant.platformPaymentMethodId,
        off_session: true,
        confirm: true,
        description: `Uptempo platform fee — ${periodStart}`,
        metadata: {
          purpose: "platform_fee",
          tenantSlug: slug,
          periodStart,
        },
      },
      { idempotencyKey: `platform-fee:${slug}:${periodStart}` },
    );

    if (paymentIntent.status === "succeeded") {
      await record("succeeded", billing.amountToChargeCents, {
        stripePaymentIntentId: paymentIntent.id,
      });
      return {
        slug,
        status: "succeeded",
        amountChargedCents: billing.amountToChargeCents,
      };
    }

    await record("failed", 0, {
      stripePaymentIntentId: paymentIntent.id,
      failureReason: `Payment status: ${paymentIntent.status}`,
    });
    return {
      slug,
      status: "failed",
      amountChargedCents: 0,
      reason: paymentIntent.status,
    };
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Charge failed";
    await record("failed", 0, { failureReason: message });
    return { slug, status: "failed", amountChargedCents: 0, reason: message };
  }
}
