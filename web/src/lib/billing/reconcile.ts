import { and, eq, sql } from "drizzle-orm";
import { syncBillableStaff } from "@/lib/billing/billable-staff";
import { HOSTED_TRIAL_DAYS } from "@/lib/billing/hosted-pricing";
import {
  ensureHostedSubscription,
  syncHostedSubscription,
} from "@/lib/billing/subscriptions";
import { isSingleMode } from "@/lib/config/mode";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";

export type ReconcileResult = {
  checked: number;
  created: string[];
  synced: string[];
  failed: string[];
};

/**
 * Nightly catch-up for hosted billing. For every launched, non-comped business:
 * recount billable staff, then create the subscription if it is missing or bring
 * its items in line. One business failing never stops the others.
 */
export async function reconcileHostedBilling(): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, created: [], synced: [], failed: [] };
  if (isSingleMode()) return result;

  // "Launched" is the onboarding step flag that launchSalon sets.
  const rows = await publicDb
    .select({
      slug: tenants.slug,
      subscriptionId: tenants.stripeSubscriptionId,
      billingSwitchedAt: tenants.billingSwitchedAt,
    })
    .from(tenants)
    .where(
      and(
        eq(tenants.comped, 0),
        eq(tenants.status, "active"),
        sql`${tenants.onboardingSteps} ->> 'launched' = 'true'`,
      ),
    );

  for (const { slug, subscriptionId, billingSwitchedAt } of rows) {
    result.checked += 1;
    try {
      // Legacy businesses with no hosted subscription must not receive a new
      // 14-day trial before the noticed switch. 6.5b creates it with no trial.
      if (!subscriptionId && billingSwitchedAt == null) continue;
      await syncBillableStaff(slug);
      if (!subscriptionId) {
        // A business that launched long ago and only now gets a subscription still gets the full trial.
        const created = await ensureHostedSubscription(slug, {
          trialDays: HOSTED_TRIAL_DAYS,
        });
        if ("subscriptionId" in created) result.created.push(slug);
      } else {
        await syncHostedSubscription(slug);
        result.synced.push(slug);
      }
    } catch (error) {
      console.error("[billing] reconcileHostedBilling failed", slug, error);
      result.failed.push(slug);
    }
  }
  return result;
}
