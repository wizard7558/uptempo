/**
 * The booking core: one place that decides a booking may happen (the engine),
 * writes it (one transaction), and turns database races into clear answers.
 * Not a server action file; callers validate input and pass the tenant slug.
 */
import { addMinutes } from "date-fns";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getT } from "@/lib/terms/server";
import { withTenantDb, type TenantTransaction } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { getMultiServiceDuration } from "@/lib/services/duration";
import { checkBooking, resolveBookingLocation } from "@/lib/scheduling/service";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { failureCodeFor, type BookingFailureCode } from "@/lib/scheduling/reasons";
import type { Busy } from "@/lib/scheduling/types";
import { deriveGroupKind } from "./group-kind";
import { insertAppointmentRows, type LineOverride } from "./write-booking";

/** How many times a booking is tried when a racing booking takes its resource. */
export const RESOURCE_RETRY_ATTEMPTS = 3;

/** True for a 23P01 raised by the resource exclusion constraint or the capacity trigger. */
export function isResourceConflict(err: unknown): boolean {
  const info = pgErrorInfo(err);
  return info.code === "23P01" && (info.constraint?.startsWith("appointment_resources_") ?? false);
}

/**
 * Runs `attempt` again (up to `attempts` times in total) while it fails because a
 * racing booking took its resource. Each run must redo the engine check, so it
 * picks another chair. The last error is thrown when every attempt lost.
 */
export async function withResourceRetry<T>(
  attempts: number,
  attempt: () => Promise<T>,
): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await attempt();
    } catch (err) {
      if (n >= attempts || !isResourceConflict(err)) throw err;
    }
  }
}

/** Failure code for a database race, or null when `err` is not one. */
export function bookingCodeForDbError(err: unknown): "SLOT_TAKEN" | "RESOURCE_TAKEN" | null {
  if (isResourceConflict(err)) return "RESOURCE_TAKEN";
  if (pgErrorInfo(err).code === "23P01") return "SLOT_TAKEN";
  return null;
}

/**
 * Validates a flex (double-book) child against its host appointment.
 * Returns an error message or null when valid.
 */
export async function validateFlexBooking(
  tx: TenantTransaction,
  { appointments, appointmentServices, services }: TenantTables,
  params: {
    parentAppointmentId: string;
    staffId: string;
    resolvedLocationId: string;
    childStart: Date;
    childEnd: Date;
  },
): Promise<string | null> {
  const {
    parentAppointmentId,
    staffId,
    resolvedLocationId,
    childStart,
    childEnd,
  } = params;

  const [parent] = await tx
    .select({
      id: appointments.id,
      staffId: appointments.staffId,
      during: appointments.during,
      locationId: appointments.locationId,
      isDoubleBook: appointments.isDoubleBook,
      doubleBookParentAppointmentId: appointments.doubleBookParentAppointmentId,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.id, parentAppointmentId),
        ne(appointments.status, "cancelled"),
      ),
    )
    .limit(1)
    // Serialize concurrent flex bookings on the same host: the sibling check
    // below must see any child committed before this lock was granted.
    .for("update");

  if (!parent) {
    return "Host appointment not found or is cancelled";
  }
  if (parent.staffId !== staffId) {
    return (await getT("errors"))("appointments.hostWrongStaff");
  }
  if (parent.isDoubleBook === 1) {
    return "Cannot attach a flex booking to another flex booking";
  }
  if (parent.doubleBookParentAppointmentId != null) {
    return "Host appointment cannot be a flex booking child";
  }
  if (parent.locationId !== resolvedLocationId) {
    return "Host appointment is at a different location";
  }

  const [sibling] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.doubleBookParentAppointmentId, parentAppointmentId),
        ne(appointments.status, "cancelled"),
      ),
    )
    .limit(1);

  if (sibling) {
    return "This time slot already has a flex booking for that appointment";
  }

  const [firstLine] = await tx
    .select({
      serviceId: appointmentServices.serviceId,
      activeMinutes: appointmentServices.activeMinutes,
      processingMinutes: appointmentServices.processingMinutes,
    })
    .from(appointmentServices)
    .where(eq(appointmentServices.appointmentId, parentAppointmentId))
    .limit(1);

  let activeMinutes: number | null = null;
  let processingMinutes: number | null = null;

  if (firstLine) {
    if (
      firstLine.activeMinutes != null &&
      firstLine.processingMinutes != null
    ) {
      activeMinutes = firstLine.activeMinutes;
      processingMinutes = firstLine.processingMinutes;
    } else if (firstLine.serviceId) {
      const [svc] = await tx
        .select({
          activeMinutes: services.activeMinutes,
          processingMinutes: services.processingMinutes,
        })
        .from(services)
        .where(eq(services.id, firstLine.serviceId))
        .limit(1);
      if (svc) {
        activeMinutes = firstLine.activeMinutes ?? svc.activeMinutes;
        processingMinutes =
          firstLine.processingMinutes ?? svc.processingMinutes;
      }
    }
  }

  if (
    activeMinutes == null ||
    processingMinutes == null ||
    activeMinutes <= 0 ||
    processingMinutes <= 0
  ) {
    return "Host appointment has no processing window for flex booking";
  }

  const processingStart = addMinutes(parent.during.start, activeMinutes);
  const processingEnd = addMinutes(processingStart, processingMinutes);

  if (childStart < processingStart || childEnd > processingEnd) {
    return "Requested time is outside the host appointment processing window";
  }

  return null;
}

export type BookAppointmentParams = {
  slug: string;
  staffId: string;
  clientId: string;
  serviceIds: string[];
  start: Date;
  /** Requested location; null = wherever the staff member works at `start`. */
  locationId: string | null;
  /**
   * public: all booking rules. override: an admin booking that may overlap other
   * appointments but still needs free resources. series: recurring bookings.
   */
  mode: "public" | "override" | "series";
  /** Makes the booking a flex (double-book) child of this host appointment. */
  flexParentId?: string | null;
  /** Makes the booking a member of this group (the group row must already exist in the same transaction's tenant). */
  bookingGroupId?: string | null;
  /** Makes the booking one visit of a repeating series. */
  recurrenceRuleId?: string | null;
  recurrenceIndex?: number | null;
  /**
   * Lines with their own price and length (an accepted quote). They replace the
   * catalog durations and prices, and are written to appointment_services as overrides.
   */
  lineOverrides?: LineOverride[];
  /** Extra columns written on the appointment. */
  extra?: {
    depositCents?: number;
    serviceAddressId?: string | null;
    arrivalWindowMin?: number | null;
    projectId?: string | null;
  };
  /** The claimant's own waitlist hold is not busy. */
  ignoreHoldIds?: string[];
  now?: Date;
};

export type BookAppointmentResult =
  | { ok: true; id: string }
  | { ok: false; code: BookingFailureCode; message?: string };

/**
 * Checks and writes one booking. The engine check runs first; the transaction
 * then inserts the appointment, its services and its resources. If a racing
 * booking takes a resource in between, the database refuses the insert and the
 * whole attempt runs again (at most 3 times).
 */
export async function bookAppointment(p: BookAppointmentParams): Promise<BookAppointmentResult> {
  const { slug, staffId, clientId } = p;
  try {
    const [clientSnap] = await withTenantDb(slug, async (db, { clients }) =>
      db
        .select({ appointmentsBooked: clients.appointmentsBooked })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1),
    );
    const clientStatusAtBooking = (clientSnap?.appointmentsBooked ?? 0) === 0 ? "new" : "repeat";
    const isFlex = p.flexParentId != null;
    const isDoubleBook = isFlex || p.mode === "override";

    // On-site jobs: the address must be this client's, and the arrival window is
    // snapshotted from the business setting so later changes don't rewrite history.
    const serviceAddressId = p.extra?.serviceAddressId ?? null;
    let arrivalWindowMin = p.extra?.arrivalWindowMin ?? null;
    if (serviceAddressId) {
      const [own] = await withTenantDb(slug, async (db, { clientAddresses }) =>
        db
          .select({ id: clientAddresses.id })
          .from(clientAddresses)
          .where(and(eq(clientAddresses.id, serviceAddressId), eq(clientAddresses.clientId, clientId)))
          .limit(1),
      );
      if (!own) return { ok: false, code: "INVALID_ADDRESS" };
      if (arrivalWindowMin == null) {
        arrivalWindowMin = (await loadSchedulingSettings(slug)).arrivalWindowMin;
      }
    }

    return await withResourceRetry<BookAppointmentResult>(RESOURCE_RETRY_ATTEMPTS, async () => {
      // Duration, price and processing snapshots (per-staff overrides apply).
      const durationInfo = p.lineOverrides
        ? {
            services: [],
            totalMinutes: p.lineOverrides.reduce((sum, l) => sum + l.durationMinutes, 0),
          }
        : await getMultiServiceDuration(p.serviceIds, clientId, staffId, slug);
      const checkedServices = p.lineOverrides
        ? p.lineOverrides.map((l) => ({ serviceId: l.serviceId, durationMinutes: l.durationMinutes }))
        : durationInfo.services.map((svc) => ({
            serviceId: svc.serviceId,
            durationMinutes: svc.durationMinutes,
          }));
      const end = new Date(p.start.getTime() + durationInfo.totalMinutes * 60_000);
      const location = await resolveBookingLocation(slug, staffId, p.start, p.locationId, {
        allowOffShift: p.mode !== "public",
      });
      if (!location) return { ok: false, code: "STAFF_UNAVAILABLE" };

      const guard = await checkBooking({
        slug,
        staffId,
        start: p.start,
        services: checkedServices,
        totalMinutes: durationInfo.totalMinutes,
        locationId: location.id,
        mode: p.mode,
        clientId,
        serviceAddressId,
        ignoreHoldIds: p.ignoreHoldIds,
        now: p.now,
      });
      if (!guard.ok) return { ok: false, code: failureCodeFor(guard.reasons) };

      return withTenantDb(slug, async (db, tables) =>
        db.transaction(async (tx): Promise<BookAppointmentResult> => {
          if (isFlex) {
            const flexError = await validateFlexBooking(tx, tables, {
              parentAppointmentId: p.flexParentId!,
              staffId,
              resolvedLocationId: location.id,
              childStart: p.start,
              childEnd: end,
            });
            if (flexError) return { ok: false, code: "INVALID_FLEX", message: flexError };
          }
          const row = await insertAppointmentRows(tx, tables, {
            staffId,
            clientId,
            locationId: location.id,
            start: p.start,
            end,
            isDoubleBook,
            doubleBookParentAppointmentId: isFlex ? p.flexParentId! : null,
            clientStatusAtBooking,
            services: durationInfo.services,
            resources: guard.resources,
            bookingGroupId: p.bookingGroupId ?? null,
            recurrenceRuleId: p.recurrenceRuleId ?? null,
            recurrenceIndex: p.recurrenceIndex ?? null,
            lineOverrides: p.lineOverrides,
            depositCents: p.extra?.depositCents,
            serviceAddressId,
            arrivalWindowMin,
            projectId: p.extra?.projectId ?? null,
          });
          return { ok: true, id: row.id };
        }),
      );
    });
  } catch (err) {
    const code = bookingCodeForDbError(err);
    if (code) return { ok: false, code };
    throw err;
  }
}

export type GroupMemberInput = {
  staffId: string;
  clientId: string;
  serviceIds: string[];
  start: Date;
  /** Requested location; null = wherever the staff member works at `start`. */
  locationId: string | null;
};

export type BookGroupParams = {
  slug: string;
  /** The client who pays for the whole group. */
  payerClientId: string;
  /** 2 to 8 members. */
  members: GroupMemberInput[];
  notes?: string | null;
  now?: Date;
};

export type BookGroupResult =
  | { ok: true; groupId: string; appointmentIds: string[] }
  | { ok: false; code: BookingFailureCode; message?: string };

export const GROUP_MIN_MEMBERS = 2;
export const GROUP_MAX_MEMBERS = 8;

/**
 * Books several appointments as one group (admin override: members may overlap
 * other appointments, but every one needs free resources). Members are checked in
 * order and each sees the resources the earlier members will hold, so two members
 * never pick the same chair. Then one transaction writes the group and every
 * member, so either everyone is booked or nothing is. Retries like
 * `bookAppointment` when a racing booking takes a resource.
 */
export async function bookGroup(p: BookGroupParams): Promise<BookGroupResult> {
  const { slug, members } = p;
  if (members.length < GROUP_MIN_MEMBERS || members.length > GROUP_MAX_MEMBERS) {
    return { ok: false, code: "STAFF_UNAVAILABLE" };
  }
  try {
    const clientIds = [...new Set([p.payerClientId, ...members.map((m) => m.clientId)])];
    const seen = await withTenantDb(slug, async (db, { clients }) =>
      db
        .select({ id: clients.id, appointmentsBooked: clients.appointmentsBooked })
        .from(clients)
        .where(inArray(clients.id, clientIds)),
    );
    const bookedBefore = new Map(seen.map((c) => [c.id, c.appointmentsBooked ?? 0]));
    const kind = deriveGroupKind(
      members.map((m) => ({ clientId: m.clientId, serviceIds: m.serviceIds, startTime: m.start })),
    );

    return await withResourceRetry<BookGroupResult>(RESOURCE_RETRY_ATTEMPTS, async () => {
      type Planned = {
        member: GroupMemberInput;
        locationId: string;
        end: Date;
        services: Awaited<ReturnType<typeof getMultiServiceDuration>>["services"];
        resources: { resourceId: string; start: Date; end: Date }[];
      };
      const planned: Planned[] = [];
      const extraBusy: Busy[] = [];
      for (const member of members) {
        const duration = await getMultiServiceDuration(
          member.serviceIds,
          member.clientId,
          member.staffId,
          slug,
        );
        const location = await resolveBookingLocation(
          slug,
          member.staffId,
          member.start,
          member.locationId,
          { allowOffShift: true }, // group members are booked in override mode below
        );
        if (!location) return { ok: false, code: "STAFF_UNAVAILABLE" };
        const guard = await checkBooking({
          slug,
          staffId: member.staffId,
          start: member.start,
          services: duration.services.map((svc) => ({
            serviceId: svc.serviceId,
            durationMinutes: svc.durationMinutes,
          })),
          totalMinutes: duration.totalMinutes,
          locationId: location.id,
          mode: "override",
          clientId: member.clientId,
          extraBusy,
          now: p.now,
        });
        if (!guard.ok) return { ok: false, code: failureCodeFor(guard.reasons) };
        for (const r of guard.resources) {
          extraBusy.push({
            resourceId: r.resourceId,
            kind: "appointment",
            interval: { start: r.start, end: r.end },
          });
        }
        planned.push({
          member,
          locationId: location.id,
          end: new Date(member.start.getTime() + duration.totalMinutes * 60_000),
          services: duration.services,
          resources: guard.resources,
        });
      }

      return withTenantDb(slug, async (db, tables) =>
        db.transaction(async (tx): Promise<BookGroupResult> => {
          const [group] = await tx
            .insert(tables.bookingGroups)
            .values({ clientId: p.payerClientId, kind, notes: p.notes?.trim() || null })
            .returning({ id: tables.bookingGroups.id });
          const ids: string[] = [];
          for (const pl of planned) {
            const row = await insertAppointmentRows(tx, tables, {
              staffId: pl.member.staffId,
              clientId: pl.member.clientId,
              locationId: pl.locationId,
              start: pl.member.start,
              end: pl.end,
              // An admin override: the database's overlap rule needs the flex flag.
              isDoubleBook: true,
              doubleBookParentAppointmentId: null,
              clientStatusAtBooking: (bookedBefore.get(pl.member.clientId) ?? 0) === 0 ? "new" : "repeat",
              services: pl.services,
              resources: pl.resources,
              bookingGroupId: group.id,
            });
            ids.push(row.id);
          }
          return { ok: true, groupId: group.id, appointmentIds: ids };
        }),
      );
    });
  } catch (err) {
    const code = bookingCodeForDbError(err);
    if (code) return { ok: false, code };
    throw err;
  }
}
