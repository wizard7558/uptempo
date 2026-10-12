"use server";

import { withTenantDb } from "@/lib/db/tenant";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import {
  weeklyScheduleSchema,
  overrideSchema,
  type WeeklyScheduleInput,
  type OverrideInput,
} from "@/lib/validators/working-hours";
import { groupWeek, type DaySchedule, type Shift } from "@/lib/scheduling/week";
import { localDay } from "@/lib/scheduling/intervals";
import { DEFAULT_TIMEZONE } from "@/lib/scheduling/load";
import { z } from "zod";
import { eq, asc, and, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";

export type AvailabilityOverrideRow = {
  id: string;
  date: string; // YYYY-MM-DD
  closed: boolean;
  shifts: Shift[];
  reason: string | null;
};

type ActionFailure = {
  success: false;
  error: { formErrors: string[]; fieldErrors: Record<string, string[] | undefined>; message?: string };
};

function failure(message: string): ActionFailure {
  return { success: false, error: { formErrors: [], fieldErrors: {}, message } };
}

const byStart = (a: Shift, b: Shift) =>
  a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;

/** The seven-day schedule for one staff member, one entry per day with its shifts. */
export async function getWorkingHoursForStaffMember(staffId: string): Promise<DaySchedule[]> {
  const { tenantSlug: slug } = await requireStaff();
  const { rows, defaultLocationId } = await withTenantDb(
    slug,
    async (db, { workingHours, locations }) => {
      const [hoursRows, firstLocationRows] = await Promise.all([
        db
          .select()
          .from(workingHours)
          .where(eq(workingHours.staffId, staffId))
          .orderBy(asc(workingHours.dayOfWeek), asc(workingHours.startTime)),
        db
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.isActive, 1))
          .orderBy(asc(locations.createdAt), asc(locations.name))
          .limit(1),
      ]);
      return { rows: hoursRows, defaultLocationId: firstLocationRows[0]?.id ?? null };
    },
  );

  // Days that have no location of their own fall back to the location the
  // staff member already works at, then to the first active location.
  const effectiveDefault =
    rows.find((r) => r.isEnabled === 1 && r.locationId)?.locationId ?? defaultLocationId;
  return groupWeek(rows, effectiveDefault);
}

/**
 * Replaces a staff member's whole week in one transaction. Each enabled shift
 * is one row; each closed day is one disabled row, which keeps "hours were
 * configured" true for onboarding.
 */
export async function saveWeeklySchedule(data: WeeklyScheduleInput) {
  const session = await requireRole("owner", "admin");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const parsed = weeklyScheduleSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
  const slug = session.tenantSlug;
    const { staffId, days } = parsed.data;
    await withTenantDb(slug, async (db, { workingHours }) => {
      await db.transaction(async (tx) => {
        await tx.delete(workingHours).where(eq(workingHours.staffId, staffId));
        type Row = typeof workingHours.$inferInsert;
        const values: Row[] = days.flatMap((day): Row[] =>
          day.isEnabled === 1
            ? day.shifts.map((s) => ({
                staffId,
                dayOfWeek: day.dayOfWeek,
                locationId: s.locationId,
                startTime: s.startTime,
                endTime: s.endTime,
                isEnabled: 1,
              }))
            : [
                {
                  staffId,
                  dayOfWeek: day.dayOfWeek,
                  locationId: null,
                  startTime: "09:00",
                  endTime: "17:00",
                  isEnabled: 0,
                },
              ],
        );
        await tx.insert(workingHours).values(values);
      });
    });

    trackEvent(
      "hours.updated",
      { stylistId: staffId, daysCount: days.filter((d) => d.isEnabled === 1).length },
      { tenantSlug: slug },
    );
    revalidatePath("/settings/hours");
    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return failure("Failed to save working hours");
  }
}

/** Upcoming days off and special hours (today and later, in the business time zone). */
export async function listAvailabilityOverrides(staffId: string): Promise<AvailabilityOverrideRow[]> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { availabilityOverrides, businessSettings }) => {
    const [settings] = await db
      .select({ timezone: businessSettings.timezone })
      .from(businessSettings)
      .limit(1);
    const today = localDay(new Date(), settings?.timezone ?? DEFAULT_TIMEZONE);
    const rows = await db
      .select()
      .from(availabilityOverrides)
      .where(and(eq(availabilityOverrides.staffId, staffId), gte(availabilityOverrides.date, today)))
      .orderBy(asc(availabilityOverrides.date));
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      closed: r.intervals.length === 0,
      shifts: r.intervals
        .map((i) => ({ startTime: i.start, endTime: i.end, locationId: i.locationId }))
        .sort(byStart),
      reason: r.reason,
    }));
  });
}

/** Creates or replaces the override for one staff member and date. Closed = no intervals. */
export async function saveAvailabilityOverride(data: OverrideInput) {
  const session = await requireRole("owner", "admin");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const parsed = overrideSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
  const slug = session.tenantSlug;
    const o = parsed.data;
    const intervals = o.closed
      ? []
      : [...o.shifts]
          .sort(byStart)
          .map((s) => ({ start: s.startTime, end: s.endTime, locationId: s.locationId }));
    const reason = o.reason?.trim() ? o.reason.trim() : null;

    const id = await withTenantDb(slug, async (db, { availabilityOverrides }) => {
      const [row] = await db
        .insert(availabilityOverrides)
        .values({ staffId: o.staffId, date: o.date, intervals, reason })
        .onConflictDoUpdate({
          target: [availabilityOverrides.staffId, availabilityOverrides.date],
          set: { intervals, reason, updatedAt: new Date() },
        })
        .returning({ id: availabilityOverrides.id });
      return row.id;
    });

    trackEvent("hours.override_saved", { stylistId: o.staffId, closed: o.closed }, { tenantSlug: slug });
    revalidatePath("/settings/hours");
    return { success: true as const, id };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return failure("Failed to save this day");
  }
}

export async function deleteAvailabilityOverride(id: string) {
  const session = await requireRole("owner", "admin");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  if (!z.string().uuid().safeParse(id).success) return failure("Invalid id");
  try {
  const slug = session.tenantSlug;
    await withTenantDb(slug, async (db, { availabilityOverrides }) => {
      await db.delete(availabilityOverrides).where(eq(availabilityOverrides.id, id));
    });
    revalidatePath("/settings/hours");
    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return failure("Failed to remove this day");
  }
}
