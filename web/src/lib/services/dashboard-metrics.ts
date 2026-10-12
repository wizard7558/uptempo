/**
 * Dashboard metric derivations
 * ----------------------------
 * Pure helpers behind `getDashboardData`. Kept DB-free so the arithmetic
 * (deltas, shares, booked-out weeks, low-ROI pick) is unit testable in
 * isolation. Money is always in cents.
 */

export interface Kpi {
  value: number;
  lastMonthValue: number;
  delta: number;
}

/** Build a KPI triple with the current-vs-last-month delta filled in. */
export function makeKpi(value: number, lastMonthValue: number): Kpi {
  return { value, lastMonthValue, delta: value - lastMonthValue };
}

/** A safe ratio: 0 when the denominator is non-positive. */
export function safeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Average ticket in cents = revenue ÷ completed appointments (rounded). */
export function avgTicketCents(
  revenueCents: number,
  completedCount: number,
): number {
  if (!(completedCount > 0)) return 0;
  return Math.round(revenueCents / completedCount);
}

/**
 * Booked-out weeks = booked minutes over a forward window ÷ the weekly
 * available minutes from working hours, to one decimal place.
 */
export function computeBookedOutWeeks(
  bookedMinutes: number,
  weeklyAvailableMinutes: number,
): number {
  if (!(weeklyAvailableMinutes > 0)) return 0;
  return Math.round((bookedMinutes / weeklyAvailableMinutes) * 10) / 10;
}

/** Month revenue ÷ goal, or null when there is no positive goal. */
export function goalProgressRatio(
  revenueCents: number,
  goalCents: number | null,
): number | null {
  if (goalCents == null || goalCents <= 0) return null;
  return revenueCents / goalCents;
}

export interface ServiceShareInput {
  serviceId: string;
  serviceName: string;
  revenueCents: number;
  minutes: number;
}

export interface TopService {
  serviceId: string;
  serviceName: string;
  revenueShareRatio: number;
}

/** The single service with the largest share of service revenue. */
export function topServiceByRevenue(
  services: ServiceShareInput[],
): TopService | null {
  const totalRevenue = services.reduce((s, r) => s + r.revenueCents, 0);
  if (!(totalRevenue > 0)) return null;

  let best: ServiceShareInput | null = null;
  for (const svc of services) {
    if (best == null || svc.revenueCents > best.revenueCents) best = svc;
  }
  if (!best || !(best.revenueCents > 0)) return null;

  return {
    serviceId: best.serviceId,
    serviceName: best.serviceName,
    revenueShareRatio: best.revenueCents / totalRevenue,
  };
}

export interface LowRoiService {
  serviceId: string;
  serviceName: string;
  revenueShareRatio: number;
  timeShareRatio: number;
}

/**
 * The service whose share of booked time most exceeds its share of revenue —
 * i.e. the biggest time-for-money imbalance. Returns null when there is no
 * positive imbalance or not enough data.
 */
export function pickLowRoiService(
  services: ServiceShareInput[],
): LowRoiService | null {
  const totalRevenue = services.reduce((s, r) => s + r.revenueCents, 0);
  const totalMinutes = services.reduce((s, r) => s + r.minutes, 0);
  if (!(totalRevenue > 0) || !(totalMinutes > 0)) return null;

  let best: LowRoiService | null = null;
  let bestImbalance = 0;
  for (const svc of services) {
    const revenueShareRatio = svc.revenueCents / totalRevenue;
    const timeShareRatio = svc.minutes / totalMinutes;
    const imbalance = timeShareRatio - revenueShareRatio;
    if (imbalance > bestImbalance) {
      bestImbalance = imbalance;
      best = {
        serviceId: svc.serviceId,
        serviceName: svc.serviceName,
        revenueShareRatio,
        timeShareRatio,
      };
    }
  }
  return best;
}

/** Human label for overall utilization, for the capacity insight. */
export function capacityStatusLabel(utilizationPercent: number): string {
  if (utilizationPercent >= 85) return "At capacity";
  if (utilizationPercent >= 60) return "Healthy";
  if (utilizationPercent >= 35) return "Room to grow";
  return "Underbooked";
}

/** Uppercase initials (up to two) from a display name. */
export function initialsFromName(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  const letters = parts.slice(0, 2).map((p) => p[0].toUpperCase());
  return letters.join("");
}

/**
 * Estimated annual earnings lift if a stylist reached their target hourly rate
 * at their current weekly hours. Null when inputs are missing or non-positive
 * (already at/above target).
 */
export function estimatedAnnualImpactCents(
  targetHourlyCents: number | null | undefined,
  actualHourlyCents: number | null | undefined,
  weeklyHours: number | null | undefined,
): number | null {
  if (
    targetHourlyCents == null ||
    actualHourlyCents == null ||
    weeklyHours == null ||
    !(targetHourlyCents > actualHourlyCents) ||
    !(weeklyHours > 0)
  ) {
    return null;
  }
  return Math.round((targetHourlyCents - actualHourlyCents) * weeklyHours * 52);
}
