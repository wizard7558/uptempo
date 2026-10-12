import { and, eq, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";

/**
 * Capacity Coach
 * --------------
 * Compares each stylist's *actual* booked hours and effective hourly earnings,
 * over a trailing window, against the goals they set (hours/week + $/hour). When
 * a stylist is working at or above their target hours yet earning under their
 * target rate, it raises a dashboard alert recommending a price increase or
 * retiring their lowest-yield service.
 *
 * The scoring (`computeCapacityInsight`) is a pure function so it can be unit
 * tested exhaustively; the tenant data fetch + alert upsert lives in
 * `evaluateCapacityForTenant`.
 */

/** Trailing window the evaluator scores (4 weeks). */
export const CAPACITY_WINDOW_DAYS = 28;

/** Grace band before flagging — avoids nagging on near-misses. */
const TOLERANCE = 0.05;

/** Cap the suggested price increase so the recommendation stays credible. */
const MAX_SUGGESTED_INCREASE_PCT = 40;

/** Stable alert type + key namespace for coach alerts. */
export const CAPACITY_ALERT_TYPE = "capacity_coach";
export const capacityDedupeKey = (staffId: string) =>
  `${CAPACITY_ALERT_TYPE}:${staffId}`;

export interface StaffServiceTotals {
  serviceId: string;
  serviceName: string;
  revenueCents: number;
  minutes: number;
}

export interface StaffGoalActuals {
  staffId: string;
  staffName: string;
  /** Goal: hours/week the stylist wants to work. Must be > 0 to evaluate. */
  targetHoursPerWeek: number;
  /** Goal: take-home per hour, in cents. Must be > 0 to evaluate. */
  targetHourlyEarningsCents: number;
  /** Completed service minutes over the window. */
  bookedMinutes: number;
  /** Completed service revenue over the window, in cents. */
  earningsCents: number;
  /** Window length in days (e.g. 28). */
  windowDays: number;
  services: StaffServiceTotals[];
}

export interface CapacityInsight {
  staffId: string;
  staffName: string;
  severity: "info" | "warning";
  /** Average actual hours worked per week over the window. */
  weeklyHours: number;
  /** Effective earnings per hour over the window, in cents. */
  hourlyEarningsCents: number;
  targetHoursPerWeek: number;
  targetHourlyEarningsCents: number;
  /** True when also working above the target hours (the painful case). */
  overworked: boolean;
  /** Percent price bump that would close the gap to the target rate. */
  suggestedIncreasePct: number;
  /** Lowest-yield service (by $/min), when one is meaningfully below target. */
  worstService: {
    serviceId: string;
    serviceName: string;
    revenuePerMinuteCents: number;
  } | null;
  title: string;
  body: string;
  dedupeKey: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Whole-dollar money for human-readable copy. */
function usd(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * Score one stylist's window. Returns null when there isn't enough signal, or
 * when the stylist is at/above their target rate (no nag warranted).
 */
export function computeCapacityInsight(
  input: StaffGoalActuals,
): CapacityInsight | null {
  const {
    staffId,
    staffName,
    targetHoursPerWeek,
    targetHourlyEarningsCents,
    bookedMinutes,
    earningsCents,
    windowDays,
    services,
  } = input;

  // Not enough to say anything meaningful.
  if (
    !(targetHoursPerWeek > 0) ||
    !(targetHourlyEarningsCents > 0) ||
    !(bookedMinutes > 0) ||
    !(windowDays > 0)
  ) {
    return null;
  }

  const weeks = windowDays / 7;
  const bookedHours = bookedMinutes / 60;
  const weeklyHours = bookedHours / weeks;
  const hourlyEarningsCents = earningsCents / bookedHours;

  // On or above target rate → nothing to flag.
  const underpaid =
    hourlyEarningsCents < targetHourlyEarningsCents * (1 - TOLERANCE);
  if (!underpaid) return null;

  const overworked = weeklyHours > targetHoursPerWeek * (1 + TOLERANCE);
  const severity: "info" | "warning" = overworked ? "warning" : "info";

  const rawIncrease =
    (targetHourlyEarningsCents / hourlyEarningsCents - 1) * 100;
  const suggestedIncreasePct = Math.min(
    MAX_SUGGESTED_INCREASE_PCT,
    Math.max(1, Math.round(rawIncrease)),
  );

  // Lowest $/min service, only surfaced if it's below the target rate/min.
  const targetPerMinuteCents = targetHourlyEarningsCents / 60;
  let worstService: CapacityInsight["worstService"] = null;
  for (const svc of services) {
    if (!(svc.minutes > 0)) continue;
    const perMin = svc.revenueCents / svc.minutes;
    if (perMin >= targetPerMinuteCents) continue;
    if (worstService == null || perMin < worstService.revenuePerMinuteCents) {
      worstService = {
        serviceId: svc.serviceId,
        serviceName: svc.serviceName,
        revenuePerMinuteCents: perMin,
      };
    }
  }

  const weeklyHoursLabel = round1(weeklyHours);
  const title = overworked
    ? "You're working over your goal for under your rate"
    : "You're under your hourly goal";

  const parts: string[] = [];
  parts.push(
    `Over the last ${round1(weeks)} weeks you averaged about ${weeklyHoursLabel}h/week and earned roughly ${usd(
      hourlyEarningsCents,
    )}/hr — under your ${usd(targetHourlyEarningsCents)}/hr goal${
      overworked
        ? `, while working above your ${targetHoursPerWeek}h/week target`
        : ""
    }.`,
  );
  if (worstService) {
    parts.push(
      `Consider raising prices about ${suggestedIncreasePct}% or retiring ${worstService.serviceName} (your lowest yield at ${usd(
        worstService.revenuePerMinuteCents * 60,
      )}/hr).`,
    );
  } else {
    parts.push(
      `Consider raising prices about ${suggestedIncreasePct}% to close the gap.`,
    );
  }

  return {
    staffId,
    staffName,
    severity,
    weeklyHours,
    hourlyEarningsCents,
    targetHoursPerWeek,
    targetHourlyEarningsCents,
    overworked,
    suggestedIncreasePct,
    worstService,
    title,
    body: parts.join(" "),
    dedupeKey: capacityDedupeKey(staffId),
  };
}

export interface CapacityEvaluationResult {
  slug: string;
  skipped: boolean;
  reason?: string;
  staffWithGoals: number;
  alertsUpserted: number;
  alertsCleared: number;
}

/**
 * Evaluate every goal-setting stylist in a tenant and reconcile their coach
 * alerts (upsert when underpaid, clear when back on track). Accepts an optional `now` for deterministic tests.
 */
export async function evaluateCapacityForTenant(
  slug: string,
  now: Date = new Date(),
): Promise<CapacityEvaluationResult> {
  const end = now;
  const start = new Date(end.getTime() - CAPACITY_WINDOW_DAYS * 86_400_000);

  return withTenantDb(slug, async (db, t) => {
    const goalStaff = await db
      .select({
        id: t.staff.id,
        displayName: t.staff.displayName,
        targetHoursPerWeek: t.staff.targetHoursPerWeek,
        targetHourlyEarningsCents: t.staff.targetHourlyEarningsCents,
      })
      .from(t.staff)
      .where(
        and(
          eq(t.staff.isActive, 1),
          sql`${t.staff.targetHoursPerWeek} is not null and ${t.staff.targetHoursPerWeek} > 0`,
          sql`${t.staff.targetHourlyEarningsCents} is not null and ${t.staff.targetHourlyEarningsCents} > 0`,
        ),
      );

    if (goalStaff.length === 0) {
      return {
        slug,
        skipped: false,
        staffWithGoals: 0,
        alertsUpserted: 0,
        alertsCleared: 0,
      };
    }

    // Completed service line items in the window, with resolved price + name.
    const lines = await db
      .select({
        staffId: t.appointments.staffId,
        serviceId: t.appointmentServices.serviceId,
        serviceName: t.services.name,
        minutes: t.appointmentServices.durationMinutes,
        priceChargedCents: t.appointmentServices.priceChargedCents,
        servicePriceCents: t.services.priceCents,
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
          sql`lower(${t.appointments.during}) < ${end.toISOString()}`,
        ),
      );

    // Aggregate per stylist → per service.
    const byStaffMember = new Map<
      string,
      {
        bookedMinutes: number;
        earningsCents: number;
        services: Map<string, StaffServiceTotals>;
      }
    >();
    for (const line of lines) {
      const minutes = line.minutes ?? 0;
      const revenue = line.priceChargedCents ?? line.servicePriceCents ?? 0;
      let agg = byStaffMember.get(line.staffId);
      if (!agg) {
        agg = { bookedMinutes: 0, earningsCents: 0, services: new Map() };
        byStaffMember.set(line.staffId, agg);
      }
      agg.bookedMinutes += minutes;
      agg.earningsCents += revenue;
      const svc = agg.services.get(line.serviceId);
      if (svc) {
        svc.minutes += minutes;
        svc.revenueCents += revenue;
      } else {
        agg.services.set(line.serviceId, {
          serviceId: line.serviceId,
          serviceName: line.serviceName ?? "Service",
          revenueCents: revenue,
          minutes,
        });
      }
    }

    let alertsUpserted = 0;
    let alertsCleared = 0;

    for (const staffMember of goalStaff) {
      const agg = byStaffMember.get(staffMember.id);
      const insight = computeCapacityInsight({
        staffId: staffMember.id,
        staffName: staffMember.displayName,
        targetHoursPerWeek: staffMember.targetHoursPerWeek ?? 0,
        targetHourlyEarningsCents: staffMember.targetHourlyEarningsCents ?? 0,
        bookedMinutes: agg?.bookedMinutes ?? 0,
        earningsCents: agg?.earningsCents ?? 0,
        windowDays: CAPACITY_WINDOW_DAYS,
        services: agg ? Array.from(agg.services.values()) : [],
      });

      const key = capacityDedupeKey(staffMember.id);
      if (!insight) {
        const cleared = await db
          .delete(t.alerts)
          .where(eq(t.alerts.dedupeKey, key))
          .returning({ id: t.alerts.id });
        alertsCleared += cleared.length;
        continue;
      }

      await db
        .insert(t.alerts)
        .values({
          type: CAPACITY_ALERT_TYPE,
          severity: insight.severity,
          title: insight.title,
          body: insight.body,
          data: insight,
          dedupeKey: key,
          readAt: null,
          dismissedAt: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: t.alerts.dedupeKey,
          set: {
            severity: insight.severity,
            title: insight.title,
            body: insight.body,
            data: insight,
            // Fresh weekly evaluation → resurface as unread + undismissed.
            readAt: null,
            dismissedAt: null,
            updatedAt: now,
          },
        });
      alertsUpserted += 1;
    }

    return {
      slug,
      skipped: false,
      staffWithGoals: goalStaff.length,
      alertsUpserted,
      alertsCleared,
    };
  });
}
