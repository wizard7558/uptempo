"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import {
  getCalendarProvider,
  getValidAccessToken,
} from "@/lib/calendar/provider";
import { and, eq, gt, lt } from "drizzle-orm";
import { pushBookingToCalendarForTenant, deleteBookingFromCalendarForTenant } from "@/lib/calendar/sync-tenant";

/**
 * Get external events for a stylist on a given day.
 * Used to merge external blocks into availability and schedule display.
 */
export async function getExternalEventsForDay(
  staffId: string,
  dayStart: Date,
  dayEnd: Date,
) {
  const slug = await getTenantSlug();
  return withTenantDb(slug, async (db, { externalEvents }) => {
    return db
      .select()
      .from(externalEvents)
      .where(
        and(
          eq(externalEvents.staffId, staffId),
          lt(externalEvents.startTime, dayEnd),
          gt(externalEvents.endTime, dayStart),
        ),
      );
  });
}

/**
 * Live free/busy check against the calendar API (not cache) at booking confirmation time.
 * Queries all active calendar connections for the stylist and checks for overlapping busy periods.
 */
export async function isExternalSlotAvailable(
  staffId: string,
  start: Date,
  end: Date,
): Promise<{
  available: boolean;
  conflicts: Array<{ start: Date; end: Date }>;
}> {
  const slug = await getTenantSlug();

  const connections = await withTenantDb(
    slug,
    async (db, { calendarConnections }) => {
      return db
        .select()
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.staffId, staffId),
            eq(calendarConnections.status, "active"),
          ),
        );
    },
  );

  if (connections.length === 0) {
    return { available: true, conflicts: [] };
  }

  const conflicts: Array<{ start: Date; end: Date }> = [];

  for (const conn of connections) {
    try {
      const accessToken = await getValidAccessToken(conn, slug);
      const provider = getCalendarProvider(
        conn.platform,
      );
      const calendarId = conn.calendarId || "primary";

      const busySlots = await provider.getFreeBusy(
        accessToken,
        calendarId,
        start,
        end,
      );

      for (const slot of busySlots) {
        if (slot.start < end && slot.end > start) {
          conflicts.push({ start: slot.start, end: slot.end });
        }
      }
    } catch (error) {
      // If the connection is broken or API fails, log and continue
      console.error(
        `External conflict check failed for connection ${conn.id}:`,
        error,
      );
    }
  }

  return { available: conflicts.length === 0, conflicts };
}

/**
 * Push a booking to the stylist's designated external calendar.
 * Creates an event via the calendar provider API.
 * Push failures do not block the booking -- eventual consistency.
 */
export async function pushBookingToCalendar(appointmentId: string) {
  const { tenantSlug: slug } = await requireStaff();
  return pushBookingToCalendarForTenant(slug, appointmentId);
}

/**
 * Update a booking on the external calendar after reschedule.
 */
export async function updateBookingOnCalendar(appointmentId: string) {
  await requireStaff();
  await pushBookingToCalendar(appointmentId);
}

/**
 * Delete a booking from the external calendar after cancellation.
 * Best-effort -- cancellation already succeeded in app.
 */
export async function deleteBookingFromCalendar(
  appointmentId: string,
  staffId: string,
) {
  const { tenantSlug: slug } = await requireStaff();
  return deleteBookingFromCalendarForTenant(slug, appointmentId, staffId);
}
