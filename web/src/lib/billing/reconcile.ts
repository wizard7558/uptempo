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
  /** Text lifecycle left fail-closed (unresolved, unsupported, uncertain, or pending). */
  textMeterAttention: string[];
};

const TEXT_METER_ATTENTION = new Set(["unresolved", "unsupported", "uncertain", "pending"]);

/**
 * Nightly catch-up for hosted billing. For every launched, non-comped business:
 * recount billable staff, then create the subscription if it is missing or bring
 * its items in line, which also reconciles the hosted text meter (and repairs a
 * meter left pending after a committed switch). One business failing never
 * stops the others.
 */
export async function reconcileHostedBilling(): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    checked: 0,
    created: [],
    synced: [],
    failed: [],
    textMeterAttention: [],
  };
  if (isSingleMode()) return result;

  // "Launched" is the onboarding step flag that launchBusiness sets.
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
        noteTextMeter(result, slug, created);
      } else {
        const synced = await syncHostedSubscription(slug);
        result.synced.push(slug);
        noteTextMeter(result, slug, synced);
      }
    } catch {
      console.error("[billing] reconcileHostedBilling failed", "hosted_reconcile_failed");
      result.failed.push(slug);
    }
  }
  return result;
}

function noteTextMeter(
  result: ReconcileResult,
  slug: string,
  outcome: { textMeter?: { outcome: string } } | object,
): void {
  const meter = "textMeter" in outcome ? outcome.textMeter : undefined;
  if (meter && TEXT_METER_ATTENTION.has(meter.outcome)) {
    result.textMeterAttention.push(slug);
  }
}
