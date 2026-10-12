"use server";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import {
  addDays,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { TZDate } from "@date-fns/tz";
import { withTenantDb } from "@/lib/db/tenant";
import { getUserRole, requireStaff } from "@/lib/auth/rbac";
import { hasPermission } from "@/lib/auth/permissions";
import {
  getBookingMetrics,
  getNewVsRepeatBookingsSnapshot,
  getRevenueTrend,
  getStaffUtilization,
} from "@/actions/analytics";
import { getMonthlyRevenueGoal } from "@/actions/revenue-goal";
import { CAPACITY_ALERT_TYPE } from "@/lib/services/capacity-coach";
import {
  computeBusinessScore,
  type BusinessScore,
} from "@/lib/services/business-score";
import { getTerms } from "@/lib/terms/server";
import {
  avgTicketCents,
  capacityStatusLabel,
  computeBookedOutWeeks,
  estimatedAnnualImpactCents,
  goalProgressRatio,
  initialsFromName,
  makeKpi,
  pickLowRoiService,
  safeRatio,
  topServiceByRevenue,
  type Kpi,
  type LowRoiService,
  type ServiceShareInput,
  type TopService,
} from "@/lib/services/dashboard-metrics";

// Forward horizon for the "booked out" KPI: 12 weeks = 84 days.
const BOOKED_OUT_HORIZON_DAYS = 84;

export interface DashboardAppointment {
  id: string;
  /** ISO start instant; the client formats it in the salon timezone. */
  time: string;
  clientName: string;
  serviceNames: string[];
  staffName: string;
  staffInitials: string;
}

export interface DashboardRecommendation {
  title: string;
  impactLabel: string;
  estimatedAnnualImpactCents: number | null;
}

export interface DashboardInsights {
  topService: TopService | null;
  lowRoiService: LowRoiService | null;
  capacityStatus: { label: string; utilizationPercent: number };
}

export interface DashboardData {
  /** IANA salon timezone driving today's window and client-side time display. */
  timezone: string;
  monthRevenueCents: number;
  lastMonthRevenueCents: number;
  revenueDeltaCents: number;
  goalCents: number | null;
  goalProgressRatio: number | null;
  dailyRevenueSeries: { date: string; revenueCents: number }[];
  todaysAppointments: DashboardAppointment[];
  kpis: {
    bookedOutWeeks: Kpi;
    avgTicketCents: Kpi;
    rebookRate: Kpi;
    retailSalesCents: Kpi;
    cancellationRate: Kpi;
  };
  insights: DashboardInsights;
  recommendation: DashboardRecommendation | null;
  businessScore: BusinessScore;
}

/**
 * One aggregated payload for the admin dashboard. Tenant-scoped and gated to
 * roles that may view revenue, mirroring the analytics dashboard. Reuses the
 * exported analytics actions where they exist and adds dashboard-specific
 * queries (today's schedule, per-service ROI, retail sales) inline in the same
 * query style.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const { tenantSlug: slug } = await requireStaff();
  const role = await getUserRole();
  if (!role || !hasPermission(role, "view_revenue")) {
    throw new Error("Unauthorized");
  }

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const lastMonthAnchor = subMonths(now, 1);
  const lastMonthStart = startOfMonth(lastMonthAnchor);
  const lastMonthEnd = endOfMonth(lastMonthAnchor);

  // Forward + historical windows for the booked-out-weeks KPI.
  const next12End = addDays(now, BOOKED_OUT_HORIZON_DAYS);
  const weekEnd = addDays(now, 6); // 7 distinct days, one of each weekday
  const prevWindowStart = lastMonthAnchor;
  const prevWindowEnd = addDays(lastMonthAnchor, BOOKED_OUT_HORIZON_DAYS);

  const goalCents = await getMonthlyRevenueGoal();

  const [
    monthTrend,
    lastMonthTrend,
    monthBooking,
    lastMonthBooking,
    monthRepeat,
    lastMonthRepeat,
    utilMonth,
    utilNext12,
    utilWeek,
    utilPrev12,
  ] = await Promise.all([
    getRevenueTrend({ start: monthStart, end: monthEnd }, "day"),
    getRevenueTrend({ start: lastMonthStart, end: lastMonthEnd }, "day"),
    getBookingMetrics({ start: monthStart, end: monthEnd }),
    getBookingMetrics({ start: lastMonthStart, end: lastMonthEnd }),
    getNewVsRepeatBookingsSnapshot({ start: monthStart, end: monthEnd }),
    getNewVsRepeatBookingsSnapshot({ start: lastMonthStart, end: lastMonthEnd }),
    getStaffUtilization({ start: monthStart, end: monthEnd }),
    getStaffUtilization({ start: now, end: next12End }),
    getStaffUtilization({ start: now, end: weekEnd }),
    getStaffUtilization({ start: prevWindowStart, end: prevWindowEnd }),
  ]);

  const tenant = await withTenantDb(slug, async (db, t) => {
    // Salon timezone drives the "today" window.
    const [policy] = await db
      .select({ timezone: t.businessSettings.timezone })
      .from(t.businessSettings)
      .limit(1);
    const tz = policy?.timezone ?? "America/New_York";
    const nowTz = new TZDate(now, tz);
    const dayStart = new Date(startOfDay(nowTz).getTime());
    const dayEnd = new Date(endOfDay(nowTz).getTime());
    const todayRange = `[${dayStart.toISOString()},${dayEnd.toISOString()})`;

    // Today's appointments (non-cancelled), earliest first.
    const apptRows = await db
      .select({
        id: t.appointments.id,
        during: t.appointments.during,
        clientName: t.clients.name,
        staffName: t.staff.displayName,
      })
      .from(t.appointments)
      .innerJoin(t.clients, eq(t.appointments.clientId, t.clients.id))
      .innerJoin(t.staff, eq(t.appointments.staffId, t.staff.id))
      .where(
        and(
          ne(t.appointments.status, "cancelled"),
          sql`${t.appointments.during} && ${todayRange}::tstzrange`,
        ),
      )
      .orderBy(asc(sql`lower(${t.appointments.during})`));

    const apptIds = apptRows.map((r) => r.id);
    const serviceNameRows =
      apptIds.length > 0
        ? await db
            .select({
              appointmentId: t.appointmentServices.appointmentId,
              name: t.services.name,
            })
            .from(t.appointmentServices)
            .innerJoin(
              t.services,
              eq(t.appointmentServices.serviceId, t.services.id),
            )
            .where(inArray(t.appointmentServices.appointmentId, apptIds))
        : [];

    const serviceNameMap = new Map<string, string[]>();
    for (const row of serviceNameRows) {
      const list = serviceNameMap.get(row.appointmentId) ?? [];
      list.push(row.name);
      serviceNameMap.set(row.appointmentId, list);
    }

    const todaysAppointments: DashboardAppointment[] = apptRows.map((row) => ({
      id: row.id,
      time: row.during.start.toISOString(),
      clientName: row.clientName,
      serviceNames: serviceNameMap.get(row.id) ?? [],
      staffName: row.staffName,
      staffInitials: initialsFromName(row.staffName),
    }));

    // Per-service revenue + booked minutes this month (for ROI insights).
    const serviceAggRows = await db
      .select({
        serviceId: t.appointmentServices.serviceId,
        serviceName: t.services.name,
        revenueCents: sql<number>`COALESCE(SUM(COALESCE(${t.appointmentServices.priceChargedCents}, ${t.services.priceCents}, 0)), 0)::int`.as(
          "revenue_cents",
        ),
        minutes: sql<number>`COALESCE(SUM(${t.appointmentServices.durationMinutes}), 0)::int`.as(
          "minutes",
        ),
      })
      .from(t.appointmentServices)
      .innerJoin(t.services, eq(t.appointmentServices.serviceId, t.services.id))
      .innerJoin(
        t.appointments,
        eq(t.appointmentServices.appointmentId, t.appointments.id),
      )
      .where(
        and(
          ne(t.appointments.status, "cancelled"),
          gte(t.appointments.createdAt, monthStart),
          lte(t.appointments.createdAt, monthEnd),
        ),
      )
      .groupBy(t.appointmentServices.serviceId, t.services.name);

    const serviceAgg: ServiceShareInput[] = serviceAggRows.map((r) => ({
      serviceId: r.serviceId,
      serviceName: r.serviceName,
      revenueCents: r.revenueCents,
      minutes: r.minutes,
    }));

    // Retail sales (paid/fulfilled storefront orders) — product subtotal only.
    const sumRetail = async (start: Date, end: Date): Promise<number> => {
      const [row] = await db
        .select({
          cents: sql<number>`COALESCE(SUM(${t.orders.subtotalCents}), 0)::int`,
        })
        .from(t.orders)
        .where(
          and(
            inArray(t.orders.status, ["paid", "fulfilled"]),
            gte(t.orders.createdAt, start),
            lte(t.orders.createdAt, end),
          ),
        );
      return row?.cents ?? 0;
    };
    const retailMonthCents = await sumRetail(monthStart, monthEnd);
    const retailLastMonthCents = await sumRetail(lastMonthStart, lastMonthEnd);

    const [productCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(t.products)
      .where(eq(t.products.isActive, 1));
    const activeProductCount = productCountRow?.count ?? 0;

    // Latest, still-active Capacity Coach recommendation.
    const [alert] = await db
      .select({
        title: t.alerts.title,
        data: t.alerts.data,
      })
      .from(t.alerts)
      .where(
        and(
          eq(t.alerts.type, CAPACITY_ALERT_TYPE),
          isNull(t.alerts.dismissedAt),
        ),
      )
      .orderBy(desc(t.alerts.createdAt))
      .limit(1);

    return {
      timezone: tz,
      todaysAppointments,
      serviceAgg,
      retailMonthCents,
      retailLastMonthCents,
      activeProductCount,
      alert: alert ?? null,
    };
  });

  // ----- Revenue -----
  const monthRevenueCents = monthTrend.reduce((s, r) => s + r.totalCents, 0);
  const lastMonthRevenueCents = lastMonthTrend.reduce(
    (s, r) => s + r.totalCents,
    0,
  );
  const dailyRevenueSeries = monthTrend.map((r) => ({
    date: format(new Date(r.period), "yyyy-MM-dd"),
    revenueCents: r.totalCents,
  }));

  // ----- Utilization aggregates -----
  const sumBooked = (rows: { bookedMinutes: number }[]) =>
    rows.reduce((s, r) => s + r.bookedMinutes, 0);
  const monthBookedMinutes = sumBooked(utilMonth);
  const monthAvailableMinutes = utilMonth.reduce(
    (s, r) => s + r.availableMinutes,
    0,
  );
  const utilizationPercent =
    monthAvailableMinutes > 0
      ? Math.round((monthBookedMinutes / monthAvailableMinutes) * 100)
      : 0;
  const weeklyAvailableMinutes = utilWeek.reduce(
    (s, r) => s + r.availableMinutes,
    0,
  );

  // ----- KPIs -----
  const bookedOutWeeks = makeKpi(
    computeBookedOutWeeks(sumBooked(utilNext12), weeklyAvailableMinutes),
    computeBookedOutWeeks(sumBooked(utilPrev12), weeklyAvailableMinutes),
  );
  const avgTicket = makeKpi(
    avgTicketCents(monthRevenueCents, monthBooking.completed),
    avgTicketCents(lastMonthRevenueCents, lastMonthBooking.completed),
  );
  const rebookRate = makeKpi(
    safeRatio(monthRepeat.repeat, monthRepeat.total),
    safeRatio(lastMonthRepeat.repeat, lastMonthRepeat.total),
  );
  const retailSales = makeKpi(
    tenant.retailMonthCents,
    tenant.retailLastMonthCents,
  );
  const cancellationRate = makeKpi(
    safeRatio(monthBooking.cancelled, monthBooking.total),
    safeRatio(lastMonthBooking.cancelled, lastMonthBooking.total),
  );

  // ----- Insights -----
  const insights: DashboardInsights = {
    topService: topServiceByRevenue(tenant.serviceAgg),
    lowRoiService: pickLowRoiService(tenant.serviceAgg),
    capacityStatus: {
      label: capacityStatusLabel(utilizationPercent),
      utilizationPercent,
    },
  };

  // ----- Recommendation (from Capacity Coach alert) -----
  let recommendation: DashboardRecommendation | null = null;
  if (tenant.alert) {
    const d = (tenant.alert.data ?? null) as {
      suggestedIncreasePct?: number;
      targetHourlyEarningsCents?: number;
      hourlyEarningsCents?: number;
      weeklyHours?: number;
    } | null;
    const pct = d?.suggestedIncreasePct;
    recommendation = {
      title: tenant.alert.title,
      impactLabel:
        typeof pct === "number" ? `Raise prices ~${pct}%` : "Review pricing",
      estimatedAnnualImpactCents: estimatedAnnualImpactCents(
        d?.targetHourlyEarningsCents,
        d?.hourlyEarningsCents,
        d?.weeklyHours,
      ),
    };
  }

  // ----- Business score -----
  const retailAttachRate =
    tenant.activeProductCount > 0 && monthRevenueCents > 0
      ? safeRatio(tenant.retailMonthCents, monthRevenueCents)
      : null;
  const businessScore = computeBusinessScore({
    terms: await getTerms(slug),
    utilizationPercent,
    repeatBookingRate: safeRatio(monthRepeat.repeat, monthRepeat.total),
    cancellationRate: safeRatio(monthBooking.cancelled, monthBooking.total),
    revenueVsGoalRatio: goalProgressRatio(monthRevenueCents, goalCents),
    retailAttachRate,
  });

  return {
    monthRevenueCents,
    lastMonthRevenueCents,
    timezone: tenant.timezone,
    revenueDeltaCents: monthRevenueCents - lastMonthRevenueCents,
    goalCents,
    goalProgressRatio: goalProgressRatio(monthRevenueCents, goalCents),
    dailyRevenueSeries,
    todaysAppointments: tenant.todaysAppointments,
    kpis: {
      bookedOutWeeks,
      avgTicketCents: avgTicket,
      rebookRate,
      retailSalesCents: retailSales,
      cancellationRate,
    },
    insights,
    recommendation,
    businessScore,
  };
}
