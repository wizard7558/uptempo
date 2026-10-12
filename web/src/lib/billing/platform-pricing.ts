import { isSingleMode } from "@/lib/config/mode";

/**
 * Platform pricing
 * ----------------
 * What the salon pays Uptempo. The model is a monthly **floor** with the
 * existing per-tier revenue percentage on top:
 *
 *     monthly platform fee = max($50, tierPercent% × monthly revenue)
 *
 * The $50 floor "covers" revenue up to the break-even point (floor ÷ percent);
 * above that, the salon pays the tier percentage. Percentages stay per plan
 * (starter/pro/business), with an optional per-tenant override — exactly the
 * tiers we already have.
 *
 * This module is the single source of truth for the fee percentage and the fee
 * math. It's pure + unit-tested; the per-transaction Stripe `application_fee`
 * and the billing preview both read from here.
 */

/** Monthly minimum the salon pays, regardless of revenue. */
export const PLATFORM_MONTHLY_FLOOR_CENTS = 5_000; // $50

/** Default revenue percentage by plan (percent, i.e. 1 = 1%). */
export const PLAN_FEE_PERCENT: Record<string, number> = {
  starter: 0.5,
  pro: 1,
  business: 2,
};

/**
 * Resolve a tenant's fee percentage: an explicit override wins (including 0 for
 * an exemption), otherwise the plan default, otherwise the PLATFORM_FEE_PERCENT
 * env fallback (0 if unset).
 */
export function feePercentForTenant(tenant: {
  plan: string;
  platformFeePercent: number | null;
}): number {
  if (isSingleMode()) return 0;
  if (tenant.platformFeePercent === 0) return 0;
  if (tenant.platformFeePercent != null) return tenant.platformFeePercent;
  return (
    PLAN_FEE_PERCENT[tenant.plan] ??
    Number.parseInt(process.env.PLATFORM_FEE_PERCENT ?? "0", 10)
  );
}

export interface PlatformFeeBreakdown {
  feePercent: number;
  floorCents: number;
  monthlyRevenueCents: number;
  /** feePercent% × revenue, rounded to the nearest cent. */
  percentFeeCents: number;
  /** What the salon actually pays: max(floor, percentFee). */
  chargeCents: number;
  /** True when the floor is the binding amount (revenue below break-even). */
  isFloor: boolean;
  /** Revenue at which percentFee equals the floor; null when percent is 0. */
  breakEvenRevenueCents: number | null;
}

/**
 * Compute the monthly platform fee for a given percentage and revenue.
 * `feePercent` is a percent (1 = 1%); revenue and the result are in cents.
 */
export function computePlatformFee(
  feePercent: number,
  monthlyRevenueCents: number,
): PlatformFeeBreakdown {
  const pct = Number.isFinite(feePercent) && feePercent > 0 ? feePercent : 0;
  const revenue = Math.max(0, Math.round(monthlyRevenueCents || 0));

  // A 0% (or missing) rate is a full exemption — the floor does not apply.
  if (pct <= 0) {
    return {
      feePercent: 0,
      floorCents: PLATFORM_MONTHLY_FLOOR_CENTS,
      monthlyRevenueCents: revenue,
      percentFeeCents: 0,
      chargeCents: 0,
      isFloor: false,
      breakEvenRevenueCents: null,
    };
  }

  const percentFeeCents = Math.round((pct / 100) * revenue);
  const chargeCents = Math.max(PLATFORM_MONTHLY_FLOOR_CENTS, percentFeeCents);
  const isFloor = percentFeeCents <= PLATFORM_MONTHLY_FLOOR_CENTS;
  const breakEvenRevenueCents = Math.ceil(
    (PLATFORM_MONTHLY_FLOOR_CENTS * 100) / pct,
  );

  return {
    feePercent: pct,
    floorCents: PLATFORM_MONTHLY_FLOOR_CENTS,
    monthlyRevenueCents: revenue,
    percentFeeCents,
    chargeCents,
    isFloor,
    breakEvenRevenueCents,
  };
}

/** Convenience: fee breakdown for a tenant given its monthly revenue. */
export function platformFeeForTenant(
  tenant: { plan: string; platformFeePercent: number | null },
  monthlyRevenueCents: number,
): PlatformFeeBreakdown {
  return computePlatformFee(feePercentForTenant(tenant), monthlyRevenueCents);
}

export interface MonthlyBillingResult {
  floorCents: number;
  feesCollectedCents: number;
  /** Additional amount the platform must charge the salon to reach the floor. */
  amountToChargeCents: number;
  exempt: boolean;
}

/**
 * What the monthly billing cron should charge, given the per-transaction
 * application fees already collected this period. Because the percentage is
 * collected continuously via Stripe `application_fee`, the only thing left to
 * bill is the shortfall up to the floor:
 *
 *     total owed  = max(floor, feesCollected)
 *     already paid = feesCollected
 *     to charge    = max(0, floor − feesCollected)
 *
 * A fee-exempt tenant (0%) owes nothing (no floor).
 */
export function computeMonthlyBilling(opts: {
  feePercent: number;
  feesCollectedCents: number;
}): MonthlyBillingResult {
  const exempt = !(opts.feePercent > 0);
  const feesCollectedCents = Math.max(0, Math.round(opts.feesCollectedCents || 0));
  const amountToChargeCents = exempt
    ? 0
    : Math.max(0, PLATFORM_MONTHLY_FLOOR_CENTS - feesCollectedCents);
  return {
    floorCents: PLATFORM_MONTHLY_FLOOR_CENTS,
    feesCollectedCents,
    amountToChargeCents,
    exempt,
  };
}
