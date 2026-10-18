import { eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getServicesForAppointment } from "@/lib/queries/appointment-services";

/**
 * Load one appointment (client, location, services, recurrence) from the named
 * tenant. NO authorization: this is for server code that already has a trusted
 * tenant slug (the booking flow that just created the appointment, or a page
 * that verified a signed link token). Never pass a slug taken from user input,
 * and never read it from request headers here.
 *
 * Staff-facing callers go through the `getAppointment` server action, which
 * requires a staff session. Server actions are public HTTP endpoints, so
 * internal callers must not import guarded actions; they import this instead.
 * (Not marked `server-only`: this repo does not use that package for lib code.)
 */
export async function loadAppointmentForTenant(slug: string, id: string) {
  return withTenantDb(slug, async (db, { appointments, appointmentServices, clients, services, locations, recurrenceRules, clientAddresses }) => {
    const [row] = await db
      .select({
        id: appointments.id,
        staffId: appointments.staffId,
        during: appointments.during,
        status: appointments.status,
        notes: appointments.notes,
        attributes: appointments.attributes,
        clientId: clients.id,
        clientName: clients.name,
        clientEmail: clients.email,
        clientPhone: clients.phone,
        locationId: locations.id,
        locationName: locations.name,
        locationAddress: locations.address,
        clientStatusAtBooking: appointments.clientStatusAtBooking,
        recurrenceRuleId: appointments.recurrenceRuleId,
        bookingGroupId: appointments.bookingGroupId,
        rrule: recurrenceRules.rrule,
        arrivalWindowMin: appointments.arrivalWindowMin,
        onMyWaySentAt: appointments.onMyWaySentAt,
        addressLine1: clientAddresses.line1,
        addressLine2: clientAddresses.line2,
        addressCity: clientAddresses.city,
        addressRegion: clientAddresses.region,
        addressPostalCode: clientAddresses.postalCode,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(locations, eq(appointments.locationId, locations.id))
      .leftJoin(recurrenceRules, eq(appointments.recurrenceRuleId, recurrenceRules.id))
      .leftJoin(clientAddresses, eq(appointments.serviceAddressId, clientAddresses.id))
      .where(eq(appointments.id, id))
      .limit(1);

    if (!row) return null;

    const apptServices = await getServicesForAppointment(db, { appointmentServices, services }, row.id);

    return {
      id: row.id,
      staffId: row.staffId,
      clientStatusAtBooking: row.clientStatusAtBooking ?? null,
      recurrenceRuleId: row.recurrenceRuleId,
      bookingGroupId: row.bookingGroupId,
      rrule: row.rrule ?? null,
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
      serviceAddress: row.addressLine1
        ? {
            line1: row.addressLine1,
            line2: row.addressLine2,
            city: row.addressCity,
            region: row.addressRegion,
            postalCode: row.addressPostalCode ?? "",
          }
        : null,
      arrivalWindowMin: row.arrivalWindowMin,
      onMyWaySentAt: row.onMyWaySentAt,
      services: apptServices,
      start: row.during.start,
      end: row.during.end,
      status: row.status,
      notes: row.notes,
      attributes: row.attributes ?? {},
    };
  });
}
