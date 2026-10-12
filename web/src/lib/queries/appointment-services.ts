import { eq, inArray } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";

// Types for the query return
export interface AppointmentServiceRow {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  isOverride: number; // 0 or 1
  /** Price snapshot at booking time (preferred) falling back to the current
   * service price. Null if neither is set. */
  priceCents: number | null;
}

/**
 * Fetch services for a single appointment. Used by getAppointment, calendar-sync, etc.
 * Accepts the Drizzle db instance and table references (for tenant-aware queries).
 */
export async function getServicesForAppointment(
  db: TenantDb,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: { appointmentServices: any; services: any },
  appointmentId: string,
): Promise<AppointmentServiceRow[]> {
  const rows = await db
    .select({
      serviceId: tables.appointmentServices.serviceId,
      serviceName: tables.services.name,
      durationMinutes: tables.appointmentServices.durationMinutes,
      isOverride: tables.appointmentServices.isOverride,
      priceChargedCents: tables.appointmentServices.priceChargedCents,
      defaultPriceCents: tables.services.priceCents,
    })
    .from(tables.appointmentServices)
    .innerJoin(
      tables.services,
      eq(tables.appointmentServices.serviceId, tables.services.id),
    )
    .where(eq(tables.appointmentServices.appointmentId, appointmentId));
  return rows.map((r) => ({
    serviceId: r.serviceId,
    serviceName: r.serviceName,
    durationMinutes: r.durationMinutes,
    isOverride: r.isOverride,
    priceCents: r.priceChargedCents ?? r.defaultPriceCents ?? null,
  }));
}

/**
 * Batch-fetch services for multiple appointments in a single query.
 * Returns a Map<appointmentId, AppointmentServiceRow[]>.
 * Eliminates N+1 pattern in schedule views.
 */
export async function getServicesForAppointments(
  db: TenantDb,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: { appointmentServices: any; services: any },
  appointmentIds: string[],
): Promise<Map<string, AppointmentServiceRow[]>> {
  if (appointmentIds.length === 0) return new Map();

  const rows = await db
    .select({
      appointmentId: tables.appointmentServices.appointmentId,
      serviceId: tables.appointmentServices.serviceId,
      serviceName: tables.services.name,
      durationMinutes: tables.appointmentServices.durationMinutes,
      isOverride: tables.appointmentServices.isOverride,
      priceChargedCents: tables.appointmentServices.priceChargedCents,
      defaultPriceCents: tables.services.priceCents,
    })
    .from(tables.appointmentServices)
    .innerJoin(
      tables.services,
      eq(tables.appointmentServices.serviceId, tables.services.id),
    )
    .where(inArray(tables.appointmentServices.appointmentId, appointmentIds));

  const grouped = new Map<string, AppointmentServiceRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.appointmentId) ?? [];
    existing.push({
      serviceId: row.serviceId,
      serviceName: row.serviceName,
      durationMinutes: row.durationMinutes,
      isOverride: row.isOverride,
      priceCents: row.priceChargedCents ?? row.defaultPriceCents ?? null,
    });
    grouped.set(row.appointmentId, existing);
  }
  return grouped;
}
