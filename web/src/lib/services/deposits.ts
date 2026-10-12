/**
 * Deposit resolution. Two layers, resolved per service:
 *
 *   per-service override (services.deposit_type/amount)
 *        beats
 *   salon global rule (salon_policies.deposit_*)
 *
 * A service's `depositType`:
 *   - 'none'            → never a deposit (even if the global rule would apply)
 *   - 'percent'         → override: `depositAmount` percent of the service price
 *   - 'fixed'           → override: `depositAmount` cents
 *   - null (inherit)    → fall back to the salon's global rule
 *
 * The global rule, when enabled, applies to inheriting services whose duration is
 * at/above `depositDurationThresholdMinutes` (or always, if the threshold is null).
 */

export interface DepositPolicy {
  depositEnabled: boolean;
  depositDefaultType: "percent" | "fixed";
  depositDefaultAmount: number;
  depositDurationThresholdMinutes: number | null;
}

export interface DepositServiceInput {
  serviceId: string;
  serviceName: string;
  priceCents: number;
  durationMinutes: number;
  depositType: string | null;
  depositAmount: number | null;
}

export interface DepositLine {
  serviceId: string;
  serviceName: string;
  depositCents: number;
}

export interface DepositBreakdown {
  totalCents: number;
  lines: DepositLine[];
}

function percentOf(priceCents: number, percent: number | null | undefined): number {
  if (!percent || priceCents <= 0) return 0;
  return Math.round((priceCents * percent) / 100);
}

/** Resolve the deposit (in cents) for a single service under a policy. */
export function resolveServiceDepositCents(
  svc: DepositServiceInput,
  policy: DepositPolicy,
): number {
  // Per-service override wins.
  if (svc.depositType === "none") return 0;
  if (svc.depositType === "percent") {
    return Math.min(percentOf(svc.priceCents, svc.depositAmount), svc.priceCents || Infinity);
  }
  if (svc.depositType === "fixed") {
    return Math.max(0, svc.depositAmount ?? 0);
  }

  // Inherit (null) → apply the global rule.
  if (!policy.depositEnabled) return 0;
  if (
    policy.depositDurationThresholdMinutes != null &&
    svc.durationMinutes < policy.depositDurationThresholdMinutes
  ) {
    return 0;
  }
  if (policy.depositDefaultType === "percent") {
    return Math.min(
      percentOf(svc.priceCents, policy.depositDefaultAmount),
      svc.priceCents || Infinity,
    );
  }
  return Math.max(0, policy.depositDefaultAmount);
}

/** Resolve the total deposit for a booking (sum across all selected services). */
export function resolveBookingDeposit(
  services: DepositServiceInput[],
  policy: DepositPolicy,
): DepositBreakdown {
  const lines = services.map((svc) => ({
    serviceId: svc.serviceId,
    serviceName: svc.serviceName,
    depositCents: resolveServiceDepositCents(svc, policy),
  }));
  return {
    totalCents: lines.reduce((sum, l) => sum + l.depositCents, 0),
    lines,
  };
}
