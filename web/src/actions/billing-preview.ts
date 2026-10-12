"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { and, eq, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import {
  platformFeeForTenant,
  type PlatformFeeBreakdown,
} from "@/lib/billing/platform-pricing";

export interface PlatformFeePreview extends PlatformFeeBreakdown {
  plan: string;
  /** Human label for the billing window, e.g. "July 2026 (so far)". */
  periodLabel: string;
}

/**
 * Preview of what the salon would owe Uptempo this month under the
 * max($50 floor, tier% × revenue) model. Revenue is completed-service revenue
 * for the current calendar month (UTC) to date, sourced from appointment line
 * items so cash-paid work counts. This is a preview only — it does not charge.
 */
export async function getPlatformFeePreview(
  now: Date = new Date(),
): Promise<PlatformFeePreview> {
  const { tenantSlug: slug } = await requireStaff();
  const tenant = await getTenantBySlug(slug);
  const plan = tenant?.plan ?? "starter";
  const platformFeePercent = tenant?.platformFeePercent ?? null;

  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );

  const monthlyRevenueCents = await withTenantDb(slug, async (db, t) => {
    const rows = await db
      .select({
        cents: sql<number>`coalesce(sum(coalesce(${t.appointmentServices.priceChargedCents}, ${t.services.priceCents}, 0)), 0)::int`,
      })
      .from(t.appointmentServices)
      .innerJoin(
        t.appointments,
        eq(t.appointmentServices.appointmentId, t.appointments.id),
      )
      .innerJoin(t.services, eq(t.appointmentServices.serviceId, t.services.id))
      .where(
        and(
          eq(t.appointments.status, "completed"),
          sql`lower(${t.appointments.during}) >= ${start.toISOString()}`,
        ),
      );
    const [retail] = await db
      .select({
        cents: sql<number>`coalesce(sum(${t.orders.subtotalCents}), 0)::int`,
      })
      .from(t.orders)
      .where(
        and(
          sql`${t.orders.status} <> 'refunded'`,
          sql`${t.orders.createdAt} >= ${start.toISOString()}`,
        ),
      );
    return Number(rows[0]?.cents ?? 0) + Number(retail?.cents ?? 0);
  });

  const breakdown = platformFeeForTenant(
    { plan, platformFeePercent },
    monthlyRevenueCents,
  );

  const monthName = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);

  return { ...breakdown, plan, periodLabel: `${monthName} (so far)` };
}
