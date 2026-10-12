import { withTenantDb } from "@/lib/db/tenant";
import { getCalendarProvider, getValidAccessToken } from "@/lib/calendar/provider";
import { getActiveConnectionForStaffInTenant } from "@/lib/calendar/tenant-connections";
import { and, eq, gte, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import { getServicesForAppointment } from "@/lib/queries/appointment-services";

export async function syncExternalEventsForConnection(
  tenantSlug: string,
  connectionId: string,
) {
  const [connection] = await withTenantDb(
    tenantSlug,
    async (db, { calendarConnections }) => {
      return db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId))
        .limit(1);
    },
  );

  if (!connection || connection.status !== "active") return;

  const accessToken = await getValidAccessToken(connection, tenantSlug);
  const provider = getCalendarProvider(
    connection.platform,
  );

  const calendarId = connection.calendarId || "primary";

  // Sync window: today → 90 days ahead
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  const busySlots = await provider.getFreeBusy(
    accessToken,
    calendarId,
    from,
    to,
  );

  // Replace stale events with fresh data in a transaction
  await withTenantDb(tenantSlug, async (db, { externalEvents }) => {
    await db.transaction(async (tx) => {
      // Clear stale events for this connection in the synced date range
      await tx
        .delete(externalEvents)
        .where(
          and(
            eq(externalEvents.connectionId, connection.id),
            gte(externalEvents.startTime, from),
            lte(externalEvents.endTime, to),
          ),
        );

      // Insert fresh events
      if (busySlots.length > 0) {
        await tx.insert(externalEvents).values(
          busySlots.map((slot) => ({
            connectionId: connection.id,
            staffId: connection.staffId,
            calendarId,
            startTime: slot.start,
            endTime: slot.end,
            isAllDay: isAllDayEvent(slot.start, slot.end) ? 1 : 0,
            freeBusyStatus: "busy" as const,
            lastSyncedAt: new Date(),
          })),
        );
      }
    });
  });

  // Update lastSyncedAt on the connection
  await withTenantDb(
    tenantSlug,
    async (db, { calendarConnections }) => {
      await db
        .update(calendarConnections)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(calendarConnections.id, connection.id));
    },
  );

  trackEvent(
    "calendar.synced",
    { connectionId: connection.id, eventsCount: busySlots.length },
    { tenantSlug },
  );

  revalidatePath("/schedule");
}

function isAllDayEvent(start: Date, end: Date): boolean {
  return (
    start.getUTCHours() === 0 &&
    start.getUTCMinutes() === 0 &&
    end.getUTCHours() === 0 &&
    end.getUTCMinutes() === 0
  );
}

export async function pushBookingToCalendarForTenant(
  tenantSlug: string,
  appointmentId: string,
) {
  const appointment = await withTenantDb(
    tenantSlug,
    async (db, { appointments, appointmentServices, clients, services, locations }) => {
      const [row] = await db
        .select({
          id: appointments.id,
          staffId: appointments.staffId,
          during: appointments.during,
          status: appointments.status,
          notes: appointments.notes,
          clientId: clients.id,
          clientName: clients.name,
          clientEmail: clients.email,
          clientPhone: clients.phone,
          locationId: locations.id,
          locationName: locations.name,
          locationAddress: locations.address,
        })
        .from(appointments)
        .innerJoin(clients, eq(appointments.clientId, clients.id))
        .leftJoin(locations, eq(appointments.locationId, locations.id))
        .where(eq(appointments.id, appointmentId))
        .limit(1);

      if (!row) return null;

      const apptServices = await getServicesForAppointment(
        db,
        { appointmentServices, services },
        row.id,
      );

      return {
        id: row.id,
        staffId: row.staffId,
        client: {
          id: row.clientId,
          name: row.clientName,
          email: row.clientEmail,
          phone: row.clientPhone,
        },
        location: row.locationId
          ? {
              id: row.locationId,
              name: row.locationName,
              address: row.locationAddress,
            }
          : null,
        services: apptServices,
        start: row.during.start,
        end: row.during.end,
        status: row.status,
        notes: row.notes,
      };
    },
  );

  if (!appointment) return;

  const connection = await getActiveConnectionForStaffInTenant(
    tenantSlug,
    appointment.staffId,
  );
  if (!connection || !connection.calendarId) {
    // No active connection with push target -- mark as not applicable
    await withTenantDb(tenantSlug, async (db, { appointments }) => {
      await db
        .update(appointments)
        .set({
          calendarSyncStatus: "not_applicable",
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, appointmentId));
    });
    return;
  }

  const serviceNames = appointment.services
    .map((s) => s.serviceName)
    .join(", ");
  const clientName = appointment.client.name ?? "Client";
  const totalDuration = appointment.services.reduce(
    (sum, s) => sum + s.durationMinutes,
    0,
  );

  try {
    const accessToken = await getValidAccessToken(connection, tenantSlug);
    const provider = getCalendarProvider(
      connection.platform,
    );

    const event = await provider.createEvent(
      accessToken,
      connection.calendarId,
      {
        title: `${clientName} - ${serviceNames}`,
        description: [
          `Client: ${clientName}`,
          appointment.client.email
            ? `Email: ${appointment.client.email}`
            : null,
          appointment.client.phone
            ? `Phone: ${appointment.client.phone}`
            : null,
          appointment.location?.name
            ? `Location: ${appointment.location.name}`
            : null,
          appointment.location?.address
            ? `Address: ${appointment.location.address}`
            : null,
          `Services: ${serviceNames}`,
          `Duration: ${totalDuration} minutes`,
          appointment.notes ? `Notes: ${appointment.notes}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        startTime: appointment.start,
        endTime: appointment.end,
        timezone: "Etc/UTC",
        location:
          appointment.location?.address ??
          appointment.location?.name ??
          undefined,
        attendees: appointment.client.email
          ? [{ email: appointment.client.email, name: clientName }]
          : undefined,
      },
    );

    // Mark as pushed with the provider's event ID
    await withTenantDb(tenantSlug, async (db, { appointments }) => {
      await db
        .update(appointments)
        .set({
          calendarEventId: event.id,
          calendarSyncStatus: "pushed",
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, appointmentId));
    });

    trackEvent(
      "calendar.event_pushed",
      { appointmentId, eventId: event.id },
      { tenantSlug },
    );
  } catch (error) {
    console.error("Failed to push event to calendar:", error);
    await withTenantDb(tenantSlug, async (db, { appointments }) => {
      await db
        .update(appointments)
        .set({
          calendarSyncStatus: "failed",
          updatedAt: new Date(),
        })
        .where(eq(appointments.id, appointmentId));
    });
  }
}

export async function updateBookingOnCalendarForTenant(
  tenantSlug: string,
  appointmentId: string,
) {
  await pushBookingToCalendarForTenant(tenantSlug, appointmentId);
}

export async function deleteBookingFromCalendarForTenant(
  tenantSlug: string,
  appointmentId: string,
  staffId: string,
) {
  const connection = await getActiveConnectionForStaffInTenant(
    tenantSlug,
    staffId,
  );
  if (!connection || !connection.calendarId) return;

  // Get the calendar event ID from the appointment
  const [appointment] = await withTenantDb(
    tenantSlug,
    async (db, { appointments }) => {
      return db
        .select({ calendarEventId: appointments.calendarEventId })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
    },
  );

  if (!appointment?.calendarEventId) return;

  try {
    const accessToken = await getValidAccessToken(connection, tenantSlug);
    const provider = getCalendarProvider(
      connection.platform,
    );

    await provider.deleteEvent(
      accessToken,
      connection.calendarId,
      appointment.calendarEventId,
    );

    trackEvent(
      "calendar.event_deleted",
      { appointmentId, eventId: appointment.calendarEventId },
      { tenantSlug },
    );
  } catch (error) {
    console.error("Failed to delete event from calendar:", error);
  }
}
