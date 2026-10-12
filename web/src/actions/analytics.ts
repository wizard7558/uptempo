"use server";

import { withTenantDb } from "@/lib/db/tenant";
import { sql, eq, and, asc, gte, lte, lt, ne, inArray } from "drizzle-orm";
import {
  eachDayOfInterval,
  getDay,
  differenceInMinutes,
  format,
  parse,
} from "date-fns";
import { REVENUE_CHARGE_REASONS } from "@/lib/revenue/charge-reasons";
import { requireRole, requireStaff } from "@/lib/auth/rbac";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getVertical } from "@/lib/verticals";
import {
  ensureExpenseCategories,
  listExpenseCategoryRows,
} from "@/lib/expenses/seed";
import {
  computeServiceAnalytics,
  type ServiceAnalytics,
} from "@/lib/analytics/service-metrics";
import { loadServiceAnalyticsInputs } from "@/lib/analytics/service-analytics-query";
import { buildCategorySummary } from "@/lib/analytics/category-summary";

// ---------------------------------------------------------------------------
// Revenue Trend
// ---------------------------------------------------------------------------

export async function getRevenueTrend(
  dateRange: { start: Date; end: Date },
  granularity: "day" | "week" | "month",
) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(slug, async (db, { charges, businessSettings }) => {
    // Get salon timezone
    const [policy] = await db
      .select({ timezone: businessSettings.timezone })
      .from(businessSettings)
      .limit(1);
    const tz = policy?.timezone ?? "America/New_York";
    // Inline the zone as a literal. A bound parameter renders with a different
    // placeholder in the SELECT vs the GROUP BY/ORDER BY, so Postgres treats the
    // expressions as distinct and rejects the grouping ("created_at must appear
    // in the GROUP BY clause"). Validate to an IANA-shaped string to stay
    // injection-safe before inlining.
    const safeTz = /^[A-Za-z][A-Za-z0-9_+/-]*$/.test(tz)
      ? tz
      : "America/New_York";

    const truncUnit =
      granularity === "day"
        ? sql.raw("'day'")
        : granularity === "week"
          ? sql.raw("'week'")
          : sql.raw("'month'");

    const periodExpr =
      sql<string>`date_trunc(${truncUnit}, ${charges.createdAt} AT TIME ZONE ${sql.raw(`'${safeTz}'`)})::text`;

    const rows = await db
      .select({
        period: periodExpr.as("period"),
        totalCents:
          sql<number>`COALESCE(SUM(${charges.amountCents}), 0)::int`.as(
            "total_cents",
          ),
        count: sql<number>`COUNT(*)::int`.as("count"),
      })
      .from(charges)
      .where(
        and(
          eq(charges.status, "completed"),
          inArray(charges.reason, [...REVENUE_CHARGE_REASONS]),
          gte(charges.createdAt, dateRange.start),
          lte(charges.createdAt, dateRange.end),
        ),
      )
      .groupBy(periodExpr)
      .orderBy(periodExpr);

    return rows as { period: string; totalCents: number; count: number }[];
  });
}

// ---------------------------------------------------------------------------
// Booking Metrics
// ---------------------------------------------------------------------------

export async function getBookingMetrics(dateRange: {
  start: Date;
  end: Date;
}) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(slug, async (db, { appointments }) => {
    const rows = await db
      .select({
        status: appointments.status,
        statusCount: sql<number>`COUNT(*)::int`.as("status_count"),
      })
      .from(appointments)
      .where(
        and(
          gte(appointments.createdAt, dateRange.start),
          lte(appointments.createdAt, dateRange.end),
        ),
      )
      .groupBy(appointments.status);

    let total = 0;
    let completed = 0;
    let cancelled = 0;
    let noShow = 0;

    for (const row of rows) {
      const c = row.statusCount;
      total += c;
      if (row.status === "completed") completed = c;
      else if (row.status === "cancelled") cancelled = c;
      else if (row.status === "no_show") noShow = c;
    }

    return {
      total,
      completed,
      cancelled,
      noShow,
      noShowRate: total > 0 ? noShow / total : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Client Retention
// ---------------------------------------------------------------------------

export async function getClientRetention(dateRange: {
  start: Date;
  end: Date;
}) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(slug, async (db, { appointments }) => {
    // Step 1: Get distinct client IDs from non-cancelled appointments in range
    const clientsInRange = await db
      .selectDistinct({ clientId: appointments.clientId })
      .from(appointments)
      .where(
        and(
          gte(appointments.createdAt, dateRange.start),
          lte(appointments.createdAt, dateRange.end),
          ne(appointments.status, "cancelled"),
        ),
      );

    if (clientsInRange.length === 0) {
      return { newClients: 0, returningClients: 0, total: 0, retentionRate: 0 };
    }

    const clientIds = clientsInRange.map((r) => r.clientId);

    // Step 2: Check which of these clients had appointments BEFORE the date range
    const returningRows = await db
      .selectDistinct({ clientId: appointments.clientId })
      .from(appointments)
      .where(
        and(
          inArray(appointments.clientId, clientIds),
          lt(appointments.createdAt, dateRange.start),
          ne(appointments.status, "cancelled"),
        ),
      );

    const returningClients = returningRows.length;
    const total = clientIds.length;
    const newClients = total - returningClients;

    return {
      newClients,
      returningClients,
      total,
      retentionRate: total > 0 ? returningClients / total : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Service Popularity
// ---------------------------------------------------------------------------

export async function getServicePopularity(dateRange: {
  start: Date;
  end: Date;
}) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(
    slug,
    async (db, { appointmentServices, services, appointments }) => {
      const rows = await db
        .select({
          serviceId: appointmentServices.serviceId,
          serviceName: services.name,
          bookingCount:
            sql<number>`COUNT(DISTINCT ${appointmentServices.appointmentId})::int`.as(
              "booking_count",
            ),
          revenueCents:
            sql<number>`COALESCE(SUM(COALESCE(${appointmentServices.priceChargedCents}, ${services.priceCents}, 0)), 0)::int`.as(
              "revenue_cents",
            ),
        })
        .from(appointmentServices)
        .innerJoin(
          services,
          eq(appointmentServices.serviceId, services.id),
        )
        .innerJoin(
          appointments,
          eq(appointmentServices.appointmentId, appointments.id),
        )
        .where(
          and(
            ne(appointments.status, "cancelled"),
            gte(appointments.createdAt, dateRange.start),
            lte(appointments.createdAt, dateRange.end),
          ),
        )
        .groupBy(appointmentServices.serviceId, services.name)
        .orderBy(
          sql`COUNT(DISTINCT ${appointmentServices.appointmentId}) DESC`,
        );

      return rows as {
        serviceId: string;
        serviceName: string;
        bookingCount: number;
        revenueCents: number;
      }[];
    },
  );
}

// ---------------------------------------------------------------------------
// Expense vs Revenue Summary
// ---------------------------------------------------------------------------

export async function getExpenseRevenueSummary(dateRange: {
  start: Date;
  end: Date;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const startDate = format(dateRange.start, "yyyy-MM-dd");
  const endDate = format(dateRange.end, "yyyy-MM-dd");

  await ensureExpenseCategories(slug);
  const expenseCategories = await listExpenseCategoryRows(slug, {
    includeHidden: true,
  });

  const loaded = await withTenantDb(
    slug,
    async (
      db,
      {
        charges,
        appointments,
        appointmentServices,
        services,
        expenses,
        serviceCategories,
      },
    ) => {
      const revenueRows = await db
        .select({
          category: services.category,
          totalCents:
            sql<number>`COALESCE(SUM(COALESCE(${appointmentServices.priceChargedCents}, ${services.priceCents}, 0)), 0)::int`.as(
              "total_cents",
            ),
          serviceCostCents:
            sql<number>`COALESCE(SUM(COALESCE(${services.costCents}, 0)), 0)::int`.as(
              "service_cost_cents",
            ),
          bookings:
            sql<number>`COUNT(DISTINCT ${appointmentServices.appointmentId})::int`.as(
              "bookings",
            ),
          totalMinutes:
            sql<number>`COALESCE(SUM(${appointmentServices.durationMinutes}), 0)::int`.as(
              "total_minutes",
            ),
        })
        .from(appointmentServices)
        .innerJoin(services, eq(appointmentServices.serviceId, services.id))
        .innerJoin(
          appointments,
          eq(appointmentServices.appointmentId, appointments.id),
        )
        .innerJoin(
          charges,
          and(
            eq(charges.appointmentId, appointments.id),
            eq(charges.reason, "service_payment"),
            eq(charges.status, "completed"),
          ),
        )
        .where(
          and(
            eq(appointments.status, "completed"),
            gte(charges.createdAt, dateRange.start),
            lte(charges.createdAt, dateRange.end),
          ),
        )
        .groupBy(services.category)
        .orderBy(services.category);

      const expenseRows = await db
        .select({
          category: expenses.category,
          totalCents:
            sql<number>`COALESCE(SUM(${expenses.amountCents}), 0)::int`.as(
              "total_cents",
            ),
        })
        .from(expenses)
        .where(
          and(
            gte(expenses.expenseDate, startDate),
            lte(expenses.expenseDate, endDate),
          ),
        )
        .groupBy(expenses.category)
        .orderBy(expenses.category);

      const serviceCategoryRows = await db
        .select({
          slug: serviceCategories.slug,
          name: serviceCategories.name,
          isActive: serviceCategories.isActive,
        })
        .from(serviceCategories)
        .orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.name));

      return { revenueRows, expenseRows, serviceCategoryRows };
    },
  );

  const tenant = await getTenantBySlug(slug);
  return buildCategorySummary({
    serviceCategories: loaded.serviceCategoryRows.map((r) => ({
      slug: r.slug,
      name: r.name,
      isActive: r.isActive === 1,
    })),
    packCategories: getVertical(tenant?.industry).categories,
    revenueRows: loaded.revenueRows,
    expenseRows: loaded.expenseRows,
    expenseCategories,
  });
}

// ---------------------------------------------------------------------------
// Stylist Utilization
// ---------------------------------------------------------------------------

export async function getStaffUtilization(dateRange: {
  start: Date;
  end: Date;
}) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(
    slug,
    async (db, { appointments, staff, workingHours }) => {
      // Step 1: Booked minutes per stylist from non-cancelled appointments.
      // Use explicit range bounds for broad Postgres compatibility.
      const windowRange = sql`tstzrange(${dateRange.start.toISOString()}::timestamptz, ${dateRange.end.toISOString()}::timestamptz, '[]')`;
      const bookedRows = await db
        .select({
          staffId: appointments.staffId,
          staffName: staff.displayName,
          bookedMinutes: sql<number>`
            COALESCE(
              SUM(
                EXTRACT(EPOCH FROM (upper(${appointments.during}) - lower(${appointments.during}))) / 60.0
              ),
              0
            )::int
          `.as("booked_minutes"),
        })
        .from(appointments)
        .innerJoin(staff, eq(appointments.staffId, staff.id))
        .where(
          and(
            ne(appointments.status, "cancelled"),
            sql`${appointments.during} <@ ${windowRange}`,
          ),
        )
        .groupBy(appointments.staffId, staff.displayName);

      // Step 2: Get all enabled working hours
      const whRows = await db
        .select({
          staffId: workingHours.staffId,
          dayOfWeek: workingHours.dayOfWeek,
          startTime: workingHours.startTime,
          endTime: workingHours.endTime,
        })
        .from(workingHours)
        .where(eq(workingHours.isEnabled, 1));

      // Step 3: Calculate available minutes per stylist
      const days = eachDayOfInterval({
        start: dateRange.start,
        end: dateRange.end,
      });

      // Build a map: stylistId -> total available minutes
      const availableMap = new Map<string, number>();
      for (const day of days) {
        const dow = getDay(day); // 0=Sunday
        for (const wh of whRows) {
          if (wh.dayOfWeek === dow) {
            const startParsed = parse(wh.startTime, "HH:mm", day);
            const endParsed = parse(wh.endTime, "HH:mm", day);
            const mins = differenceInMinutes(endParsed, startParsed);
            if (mins > 0) {
              availableMap.set(
                wh.staffId,
                (availableMap.get(wh.staffId) ?? 0) + mins,
              );
            }
          }
        }
      }

      // Step 4: Combine booked + available
      // Collect all stylist IDs from both sources
      const allStaffIds = new Set<string>();
      for (const row of bookedRows) allStaffIds.add(row.staffId);
      for (const [sid] of availableMap) allStaffIds.add(sid);

      // Build name map from bookedRows
      const nameMap = new Map<string, string>();
      for (const row of bookedRows) nameMap.set(row.staffId, row.staffName);

      // If a stylist is in availableMap but not bookedRows, we need their name
      // Query those stylists
      const missingStaffIds = [...allStaffIds].filter(
        (id) => !nameMap.has(id),
      );
      if (missingStaffIds.length > 0) {
        const missingStaff = await db
          .select({
            id: staff.id,
            displayName: staff.displayName,
          })
          .from(staff)
          .where(inArray(staff.id, missingStaffIds));
        for (const s of missingStaff) {
          nameMap.set(s.id, s.displayName);
        }
      }

      const result = [...allStaffIds].map((staffId) => {
        const booked =
          bookedRows.find((r) => r.staffId === staffId)?.bookedMinutes ?? 0;
        const available = availableMap.get(staffId) ?? 0;
        return {
          staffId,
          staffName: nameMap.get(staffId) ?? "Unknown",
          bookedMinutes: booked,
          availableMinutes: available,
          utilizationPercent:
            available > 0 ? Math.round((booked / available) * 100) : 0,
        };
      });

      return result;
    },
  );
}

/** Bookings in range with client_status_at_booking snapshot (new vs repeat). */
export async function getNewVsRepeatBookingsSnapshot(dateRange: {
  start: Date;
  end: Date;
}) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(slug, async (db, { appointments }) => {
    const rows = await db
      .select({
        bucket: appointments.clientStatusAtBooking,
        cnt: sql<number>`COUNT(*)::int`.as("cnt"),
      })
      .from(appointments)
      .where(
        and(
          gte(appointments.createdAt, dateRange.start),
          lte(appointments.createdAt, dateRange.end),
          ne(appointments.status, "cancelled"),
        ),
      )
      .groupBy(appointments.clientStatusAtBooking);

    let newCount = 0;
    let repeatCount = 0;
    for (const row of rows) {
      if (row.bucket === "new") newCount += row.cnt;
      else if (row.bucket === "repeat") repeatCount += row.cnt;
    }

    return {
      new: newCount,
      repeat: repeatCount,
      total: newCount + repeatCount,
    };
  });
}

// ---------------------------------------------------------------------------
// Return Frequency (client loyalty)
// ---------------------------------------------------------------------------

/**
 * Distribution of clients by lifetime visit count (non-cancelled appointments),
 * bucketed to show how "sticky" the client base is. All-time across every client
 * — intentionally not scoped to the selected date range, since loyalty is a
 * lifetime measure.
 */
export async function getReturnFrequencyBuckets() {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(slug, async (db, { appointments }) => {
    const rows = await db
      .select({
        clientId: appointments.clientId,
        visits: sql<number>`COUNT(*)::int`.as("visits"),
      })
      .from(appointments)
      .where(ne(appointments.status, "cancelled"))
      .groupBy(appointments.clientId);

    const buckets = [
      { key: "1-5", label: "1–5 visits", min: 1, max: 5, count: 0 },
      { key: "6-10", label: "6–10 visits", min: 6, max: 10, count: 0 },
      { key: "11-15", label: "11–15 visits", min: 11, max: 15, count: 0 },
      {
        key: "16+",
        label: "16+ visits",
        min: 16,
        max: Number.POSITIVE_INFINITY,
        count: 0,
      },
    ];

    for (const row of rows) {
      const bucket = buckets.find(
        (b) => row.visits >= b.min && row.visits <= b.max,
      );
      if (bucket) bucket.count++;
    }

    return buckets.map(({ key, label, count }) => ({ key, label, count }));
  });
}

// ---------------------------------------------------------------------------
// Service analytics (per service and per staff member)
// ---------------------------------------------------------------------------

export async function getServiceAnalytics(dateRange: {
  start: Date;
  end: Date;
}): Promise<ServiceAnalytics> {
  const { tenantSlug: slug } = await requireStaff();
  const { lines, history } = await withTenantDb(slug, (db, t) =>
    loadServiceAnalyticsInputs(db, t, dateRange),
  );
  return computeServiceAnalytics(lines, history);
}

// ---------------------------------------------------------------------------
// Combined Dashboard Fetch
// ---------------------------------------------------------------------------

export async function getAnalyticsDashboard(
  dateRange: { start: Date; end: Date },
  granularity: "day" | "week" | "month",
) {
  await requireRole("owner", "admin");
  const [
    revenueTrend,
    bookingMetrics,
    clientRetention,
    servicePopularity,
    staffUtilization,
    expenseRevenueSummary,
    newVsRepeatBookings,
    returnFrequency,
    serviceAnalytics,
  ] = await Promise.all([
    getRevenueTrend(dateRange, granularity),
    getBookingMetrics(dateRange),
    getClientRetention(dateRange),
    getServicePopularity(dateRange),
    getStaffUtilization(dateRange),
    getExpenseRevenueSummary(dateRange),
    getNewVsRepeatBookingsSnapshot(dateRange),
    getReturnFrequencyBuckets(),
    getServiceAnalytics(dateRange),
  ]);

  const totalRevenueCents = revenueTrend.reduce(
    (sum, r) => sum + r.totalCents,
    0,
  );

  return {
    revenueTrend,
    bookingMetrics,
    clientRetention,
    servicePopularity,
    staffUtilization,
    totalRevenueCents,
    expenseRevenueSummary,
    newVsRepeatBookings,
    returnFrequency,
    serviceAnalytics,
  };
}
