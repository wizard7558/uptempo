/**
 * Row writers shared by every path that creates or moves a booking. They run
 * inside a transaction the caller owns, so an appointment, its services and the
 * resources it holds are written together or not at all.
 */
import { eq } from "drizzle-orm";
import type { TenantTransaction } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import type { ServiceDurationInfo } from "@/lib/services/duration";

/** A resource held for part of a booking. */
export type ResourceHold = { resourceId: string; start: Date; end: Date };

export type AppointmentWrite = {
  staffId: string;
  clientId: string;
  locationId: string;
  start: Date;
  end: Date;
  isDoubleBook: boolean;
  doubleBookParentAppointmentId: string | null;
  clientStatusAtBooking: "new" | "repeat";
  services: ServiceDurationInfo[];
  resources: ResourceHold[];
  /** Set when the appointment is one member of a group booking. */
  bookingGroupId?: string | null;
  /** Set when the appointment is one visit of a repeating series. */
  recurrenceRuleId?: string | null;
  recurrenceIndex?: number | null;
  /**
   * Lines with their own price and length (an accepted quote). When set they are
   * written instead of `services`, flagged as overrides, with `notes` as the line text.
   */
  lineOverrides?: LineOverride[];
  /** Deposit due for this appointment, in cents. */
  depositCents?: number;
  /** On-site visits: the client's address and the arrival window (minutes) shown at booking. */
  serviceAddressId?: string | null;
  arrivalWindowMin?: number | null;
  /** The multi-session project this appointment belongs to. */
  projectId?: string | null;
};

/** One line of a booking that carries its own price and length. */
export type LineOverride = {
  serviceId: string;
  durationMinutes: number;
  priceCents: number;
  notes: string;
};

/** Inserts the resource rows for one appointment. The database decides whether each fits. */
export async function insertResourceRows(
  tx: TenantTransaction,
  { appointmentResources }: TenantTables,
  appointmentId: string,
  holds: ResourceHold[],
): Promise<void> {
  if (holds.length === 0) return;
  await tx.insert(appointmentResources).values(
    holds.map((h) => ({
      appointmentId,
      resourceId: h.resourceId,
      during: { start: h.start, end: h.end },
    })),
  );
}

/** Frees everything the appointment holds and takes `holds` instead (reschedule, service edit). */
export async function replaceResourceRows(
  tx: TenantTransaction,
  tables: TenantTables,
  appointmentId: string,
  holds: ResourceHold[],
): Promise<void> {
  const { appointmentResources } = tables;
  await tx.delete(appointmentResources).where(eq(appointmentResources.appointmentId, appointmentId));
  await insertResourceRows(tx, tables, appointmentId, holds);
}

/** Inserts the appointment, its service snapshot lines and its resource rows. */
export async function insertAppointmentRows(
  tx: TenantTransaction,
  tables: TenantTables,
  w: AppointmentWrite,
): Promise<{ id: string }> {
  const { appointments, appointmentServices } = tables;
  const [appointment] = await tx
    .insert(appointments)
    .values({
      staffId: w.staffId,
      clientId: w.clientId,
      serviceId: null, // multi-service booking
      locationId: w.locationId,
      during: { start: w.start, end: w.end },
      status: "confirmed",
      isDoubleBook: w.isDoubleBook ? 1 : 0,
      doubleBookParentAppointmentId: w.doubleBookParentAppointmentId,
      clientStatusAtBooking: w.clientStatusAtBooking,
      bookingGroupId: w.bookingGroupId ?? null,
      recurrenceRuleId: w.recurrenceRuleId ?? null,
      recurrenceIndex: w.recurrenceIndex ?? null,
      ...(w.depositCents != null ? { depositCents: w.depositCents } : {}),
      ...(w.serviceAddressId != null ? { serviceAddressId: w.serviceAddressId } : {}),
      ...(w.arrivalWindowMin != null ? { arrivalWindowMin: w.arrivalWindowMin } : {}),
      ...(w.projectId != null ? { projectId: w.projectId } : {}),
    })
    .returning({ id: appointments.id });

  const lines = w.lineOverrides
    ? w.lineOverrides.map((l) => ({
        appointmentId: appointment.id,
        serviceId: l.serviceId,
        durationMinutes: l.durationMinutes,
        isOverride: 1,
        priceChargedCents: l.priceCents,
        activeMinutes: null,
        processingMinutes: null,
        notes: l.notes,
      }))
    : w.services.map((svc) => ({
      appointmentId: appointment.id,
      serviceId: svc.serviceId,
      durationMinutes: svc.durationMinutes,
      isOverride: svc.isOverride ? 1 : 0,
      priceChargedCents: svc.priceCents,
      activeMinutes: svc.activeMinutes,
      processingMinutes: svc.processingMinutes,
      notes: null,
    }));
  await tx.insert(appointmentServices).values(lines);

  await insertResourceRows(tx, tables, appointment.id, w.resources);
  return appointment;
}
