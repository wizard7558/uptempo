import { eq, ne, and, desc, inArray, sql } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";
import type { TimeRange } from "@/lib/db/custom-types";

export interface ServiceHistoryEntry {
  appointmentId: string;
  staffName: string;
  startTime: Date;
  endTime: Date;
  status: string;
  appointmentNotes: string | null;
  services: {
    appointmentServiceId: string;
    serviceId: string;
    serviceName: string;
    durationMinutes: number;
    isOverride: number;
    notes: string | null;
  }[];
  charge: {
    id: string;
    amountCents: number;
    status: string;
    reason: string;
  } | null;
}

/**
 * Fetch full service history for a client using batch queries (no N+1).
 * Returns appointments with their services, notes, staff member name, and charge data
 * in reverse-chronological order.
 */
export async function getClientServiceHistory(
  db: TenantDb,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: { appointments: any; appointmentServices: any; services: any; staff: any; charges: any },
  clientId: string,
): Promise<ServiceHistoryEntry[]> {
  // 1. Fetch all non-cancelled appointments for this client, ordered newest first
  const appointments = await db
    .select({
      id: tables.appointments.id,
      staffName: tables.staff.displayName,
      during: tables.appointments.during,
      status: tables.appointments.status,
      notes: tables.appointments.notes,
    })
    .from(tables.appointments)
    .innerJoin(tables.staff, eq(tables.appointments.staffId, tables.staff.id))
    .where(and(
      eq(tables.appointments.clientId, clientId),
      ne(tables.appointments.status, "cancelled"),
    ))
    .orderBy(desc(sql`lower(${tables.appointments.during})`));

  if (appointments.length === 0) return [];

  const appointmentIds = appointments.map((a: { id: string }) => a.id);

  // 2. Batch-fetch services for all appointments (including notes column)
  const serviceRows = await db
    .select({
      appointmentId: tables.appointmentServices.appointmentId,
      appointmentServiceId: tables.appointmentServices.id,
      serviceId: tables.appointmentServices.serviceId,
      serviceName: tables.services.name,
      durationMinutes: tables.appointmentServices.durationMinutes,
      isOverride: tables.appointmentServices.isOverride,
      notes: tables.appointmentServices.notes,
    })
    .from(tables.appointmentServices)
    .innerJoin(tables.services, eq(tables.appointmentServices.serviceId, tables.services.id))
    .where(inArray(tables.appointmentServices.appointmentId, appointmentIds));

  const servicesMap = new Map<string, ServiceHistoryEntry["services"]>();
  for (const row of serviceRows) {
    const existing = servicesMap.get(row.appointmentId) ?? [];
    existing.push({
      appointmentServiceId: row.appointmentServiceId,
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      durationMinutes: row.durationMinutes,
      isOverride: row.isOverride,
      notes: row.notes,
    });
    servicesMap.set(row.appointmentId, existing);
  }

  // 3. Batch-fetch charges for all appointments
  const chargeRows = await db
    .select({
      appointmentId: tables.charges.appointmentId,
      id: tables.charges.id,
      amountCents: tables.charges.amountCents,
      status: tables.charges.status,
      reason: tables.charges.reason,
    })
    .from(tables.charges)
    .where(inArray(tables.charges.appointmentId, appointmentIds));

  const chargesMap = new Map<string, ServiceHistoryEntry["charge"]>();
  for (const row of chargeRows) {
    chargesMap.set(row.appointmentId, {
      id: row.id,
      amountCents: row.amountCents,
      status: row.status,
      reason: row.reason,
    });
  }

  // 4. Assemble results -- `during` is parsed by custom type to { start: Date, end: Date }
  return appointments.map((appt: { id: string; staffName: string; during: TimeRange; status: string; notes: string | null }) => ({
    appointmentId: appt.id,
    staffName: appt.staffName,
    startTime: appt.during.start,
    endTime: appt.during.end,
    status: appt.status,
    appointmentNotes: appt.notes,
    services: servicesMap.get(appt.id) ?? [],
    charge: chargesMap.get(appt.id) ?? null,
  }));
}
