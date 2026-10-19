"use server";

import { getT } from "@/lib/terms/server";
import {
  DEFAULT_SMS_CONFIRMATION_TEMPLATE,
  renderSmsTemplate,
} from "@/lib/sms/template";
import { z } from "zod";
import { addMinutes, format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { withTenantDb } from "@/lib/db/tenant";
import { enforceAgeGate } from "@/lib/consent/gate";
import {
  createBookingSchema,
  rescheduleBookingSchema,
  cancelBookingSchema,
  updateAppointmentServicesSchema,
} from "@/lib/validators/booking";
import { getMultiServiceDuration } from "@/lib/services/duration";
import {
  RESOURCE_RETRY_ATTEMPTS,
  GROUP_MAX_MEMBERS,
  GROUP_MIN_MEMBERS,
  bookAppointment,
  bookGroup,
  bookingCodeForDbError,
  withResourceRetry,
} from "@/lib/booking/book";
import { insertAppointmentRows, replaceResourceRows } from "@/lib/booking/write-booking";
import { checkBooking, resolveBookingLocation } from "@/lib/scheduling/service";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { applyCheckIn } from "@/lib/schedule/check-in";
import { prepareManualSms, toPlainSms } from "@/lib/sms/plain-text";
import { sendSms } from "@/lib/sms/send";
import { materializeRule } from "@/lib/scheduling/recurrence";
import { toRrule } from "@/lib/scheduling/rrule";
import { failureCodeFor, type BookingFailureCode } from "@/lib/scheduling/reasons";
import { eq, and, ne, sql, asc, inArray, gt, lt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  getServicesForAppointments,
} from "@/lib/queries/appointment-services";
import { trackEvent } from "@/lib/analytics/events";
import { syncAutoAssistantTasksForAppointment } from "@/lib/services/sync-auto-assistant-tasks";
import { getNotificationSettingsForTenant } from "@/lib/notifications/settings";
import { AuthError, getUserRole, requireAdminRole, requireStaff } from "@/lib/auth/rbac";
import { failureMessage } from "@/lib/booking/failure-message";
import { loadAppointmentForTenant } from "@/lib/appointments/load";
import { refundCreditIfOnTime } from "@/lib/credits/cancel";
import { runAfterResponse } from "@/lib/utils/after";

const createBookingGroupSchema = z.object({
  payerClientId: z.string().uuid(),
  members: z
    .array(
      z.object({
        staffId: z.string().uuid(),
        clientId: z.string().uuid(),
        serviceIds: z.array(z.string().uuid()).min(1),
        startTime: z.string().datetime(),
        locationId: z.string().uuid().nullable().optional(),
      }),
    )
    .min(GROUP_MIN_MEMBERS)
    .max(GROUP_MAX_MEMBERS),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * Books 2 to 8 appointments as one group (couples, a party, one client with
 * several techs). Admin only. Everyone is booked or nobody is. The payer pays for
 * the whole group at one checkout.
 */
export async function createBookingGroup(data: {
  payerClientId: string;
  members: {
    staffId: string;
    clientId: string;
    serviceIds: string[];
    startTime: string;
    locationId?: string | null;
  }[];
  notes?: string | null;
}) {
  const session = await requireAdminRole();
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const parsed = createBookingGroupSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten().formErrors.join(", ") || "Invalid group booking" };
  }
  const slug = session.tenantSlug;
  const result = await bookGroup({
    slug,
    payerClientId: parsed.data.payerClientId,
    notes: parsed.data.notes,
    members: parsed.data.members.map((m) => ({
      staffId: m.staffId,
      clientId: m.clientId,
      serviceIds: m.serviceIds,
      start: new Date(m.startTime),
      locationId: m.locationId ?? null,
    })),
  });
  if (!result.ok) {
    return { success: false as const, error: (await getT("errors", slug))("appointments.groupFailed") };
  }

  // One more booking per distinct client, however many members they have.
  const clientIds = [...new Set(parsed.data.members.map((m) => m.clientId))];
  await withTenantDb(slug, async (db, { clients }) => {
    await db
      .update(clients)
      .set({ appointmentsBooked: sql`${clients.appointmentsBooked} + 1` })
      .where(inArray(clients.id, clientIds));
  });
  for (const id of result.appointmentIds) {
    await syncAutoAssistantTasksForAppointment(slug, id);
  }
  revalidatePath("/schedule");
  trackEvent(
    "booking.created",
    { source: "admin", serviceCount: parsed.data.members.length },
    { tenantSlug: slug },
  );
  return { success: true as const, groupId: result.groupId, appointmentIds: result.appointmentIds };
}

const createRecurringBookingSchema = z.object({
  staffId: z.string().uuid(),
  clientId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).min(1),
  startTime: z.string().datetime(),
  locationId: z.string().uuid().nullable().optional(),
  repeat: z.enum(["weekly", "biweekly"]),
  count: z.number().int().min(2).max(104).nullable(),
});

/**
 * Books a repeating series (every week or every 2 weeks). Admin only. The first
 * visit and the series are saved together; the next 84 days of visits are booked
 * right away and the nightly job keeps adding more. Visits that do not fit are
 * returned as `conflicts` (and raised as alerts) rather than failing the series.
 */
export async function createRecurringBooking(data: {
  staffId: string;
  clientId: string;
  serviceIds: string[];
  startTime: string;
  locationId?: string | null;
  repeat: "weekly" | "biweekly";
  count: number | null;
}) {
  const session = await requireAdminRole();
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const parsed = createRecurringBookingSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten().formErrors.join(", ") || "Invalid repeating booking" };
  }
  const { staffId, clientId, serviceIds, repeat, count } = parsed.data;
  const start = new Date(parsed.data.startTime);
  const slug = session.tenantSlug;

  try {
    const first = await withResourceRetry<
      { ok: true; ruleId: string; id: string } | { ok: false; code: BookingFailureCode }
    >(RESOURCE_RETRY_ATTEMPTS, async () => {
      const duration = await getMultiServiceDuration(serviceIds, clientId, staffId, slug);
      const location = await resolveBookingLocation(slug, staffId, start, parsed.data.locationId ?? null, {
        allowOffShift: true, // series mode
      });
      if (!location) return { ok: false, code: "STAFF_UNAVAILABLE" };
      const guard = await checkBooking({
        slug,
        staffId,
        start,
        services: duration.services.map((svc) => ({
          serviceId: svc.serviceId,
          durationMinutes: svc.durationMinutes,
        })),
        totalMinutes: duration.totalMinutes,
        locationId: location.id,
        mode: "series",
        clientId,
      });
      if (!guard.ok) return { ok: false, code: failureCodeFor(guard.reasons) };

      const timezone = (await loadSchedulingSettings(slug)).timezone;
      return withTenantDb(slug, async (db, tables) => {
        const [clientRow] = await db
          .select({ booked: tables.clients.appointmentsBooked })
          .from(tables.clients)
          .where(eq(tables.clients.id, clientId))
          .limit(1);
        return db.transaction(async (tx) => {
          const [rule] = await tx
            .insert(tables.recurrenceRules)
            .values({
              rrule: toRrule(repeat === "weekly" ? 1 : 2),
              startsAt: start,
              count,
              timezone,
              materializedThrough: start,
              staffId,
              clientId,
              locationId: location.id,
              serviceIds,
            })
            .returning({ id: tables.recurrenceRules.id });
          const row = await insertAppointmentRows(tx, tables, {
            staffId,
            clientId,
            locationId: location.id,
            start,
            end: new Date(start.getTime() + duration.totalMinutes * 60_000),
            isDoubleBook: false,
            doubleBookParentAppointmentId: null,
            clientStatusAtBooking: (clientRow?.booked ?? 0) === 0 ? "new" : "repeat",
            services: duration.services,
            resources: guard.resources,
            recurrenceRuleId: rule.id,
            recurrenceIndex: 0,
          });
          return { ok: true as const, ruleId: rule.id, id: row.id };
        });
      });
    });

    if (!first.ok) {
      return { success: false as const, error: await failureMessage(first.code, slug) };
    }

    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({ appointmentsBooked: sql`${clients.appointmentsBooked} + 1` })
        .where(eq(clients.id, clientId));
    });
    await syncAutoAssistantTasksForAppointment(slug, first.id);

    const rest = await materializeRule(slug, first.ruleId, new Date());
    const created = rest.skipped ? [] : rest.created;
    const conflicts = rest.skipped
      ? []
      : rest.conflicts.map((c) => ({ index: c.index, start: c.start.toISOString(), code: c.code }));

    revalidatePath("/schedule");
    trackEvent("booking.created", { source: "admin", serviceCount: serviceIds.length }, { tenantSlug: slug });
    return {
      success: true as const,
      ruleId: first.ruleId,
      createdCount: 1 + created.length,
      conflicts,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const code = bookingCodeForDbError(err);
    if (code) return { success: false as const, error: await failureMessage(code, slug) };
    console.error("Failed to create repeating booking:", err);
    return { success: false as const, error: "Failed to create booking" };
  }
}

/**
 * Ends a repeating series at this visit: no more visits are booked and every
 * later confirmed visit is cancelled. Admin only.
 */
export async function stopRecurrence(data: { appointmentId: string }) {
  const session = await requireAdminRole();
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const parsed = z.object({ appointmentId: z.string().uuid() }).safeParse(data);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };
  const slug = session.tenantSlug;

  const target = await withTenantDb(slug, async (db, { appointments }) => {
    const [row] = await db
      .select({ ruleId: appointments.recurrenceRuleId, during: appointments.during })
      .from(appointments)
      .where(eq(appointments.id, parsed.data.appointmentId))
      .limit(1);
    return row ?? null;
  });
  if (!target?.ruleId) return { success: false as const, error: "This visit is not part of a repeating series" };
  const ruleId = target.ruleId;
  const from = target.during.start;

  const later = await withTenantDb(slug, async (db, { appointments, recurrenceRules }) => {
    await db
      .update(recurrenceRules)
      .set({ isActive: 0, until: from, updatedAt: new Date() })
      .where(eq(recurrenceRules.id, ruleId));
    return db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.recurrenceRuleId, ruleId),
          eq(appointments.status, "confirmed"),
          sql`lower(${appointments.during}) > ${from.toISOString()}::timestamptz`,
        ),
      );
  });

  let cancelled = 0;
  for (const { id } of later) {
    const r = await cancelBooking({ appointmentId: id, reason: "Repeating series stopped" });
    if (r.success) cancelled += 1;
  }
  revalidatePath("/schedule");
  return { success: true as const, cancelled };
}

export async function createBooking(data: {
  staffId: string;
  clientId: string;
  serviceIds: string[];
  startTime: string;
  locationId?: string | null;
  isDoubleBook?: boolean;
  doubleBookParentAppointmentId?: string | null;
  allowOverlap?: boolean;
  serviceAddressId?: string | null;
  /** Multi-session projects: books this as a session of the project. */
  projectId?: string | null;
  /** Claiming a waitlist offer ignores that offer's hold. */
  waitlistHoldId?: string;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createBookingSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const {
      staffId,
      clientId,
      serviceIds,
      startTime,
      locationId,
      isDoubleBook: parsedIsDoubleBook,
      doubleBookParentAppointmentId,
      allowOverlap: parsedAllowOverlap,
      serviceAddressId,
      projectId,
      waitlistHoldId,
    } = parsed.data;
    const allowOverlap = parsedAllowOverlap ?? false;
    // An admin override forces double-book semantics at the DB layer (to
    // satisfy the exclusion constraint) but has no parent appointment.
    // bookAppointment applies both from the mode and the flex parent.
    const isFlexBooking = (parsedIsDoubleBook ?? false) && !allowOverlap;

    if (projectId) {
      // The project must exist and belong to this client.
      const [owned] = await withTenantDb(slug, async (db, { projects }) =>
        db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.clientId, clientId)))
          .limit(1),
      );
      if (!owned) {
        return {
          success: false as const,
          error: { formErrors: [], fieldErrors: {}, message: "Project not found for this client" },
        };
      }
    }

    // Staff aren't asked for a birthday, but one on file still has to meet the minimum age.
    const ageCheck = await enforceAgeGate(slug, {
      clientId,
      serviceIds,
      start: new Date(startTime),
      strict: false,
    });
    if (!ageCheck.ok) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: (await getT("consent", slug))("underage", { minAge: ageCheck.minAge }),
          code: ageCheck.code,
        },
      };
    }

    const result = await bookAppointment({
      slug,
      staffId,
      clientId,
      serviceIds,
      start: new Date(startTime),
      locationId: locationId ?? null,
      mode: allowOverlap ? "override" : "public",
      flexParentId: isFlexBooking ? doubleBookParentAppointmentId : null,
      ignoreHoldIds: waitlistHoldId ? [waitlistHoldId] : undefined,
      ...(serviceAddressId || projectId
        ? {
            extra: {
              ...(serviceAddressId ? { serviceAddressId } : {}),
              ...(projectId ? { projectId } : {}),
            },
          }
        : {}),
    });

    if (!result.ok) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: result.message ?? (await failureMessage(result.code, slug)),
          ...(result.code === "INVALID_FLEX" ? {} : { code: result.code }),
        },
      };
    }

    // Increment client's appointments_booked counter
    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({ appointmentsBooked: sql`${clients.appointmentsBooked} + 1` })
        .where(eq(clients.id, clientId));
    });

    await syncAutoAssistantTasksForAppointment(slug, result.id);

    revalidatePath("/schedule");
    trackEvent("booking.created", { source: "admin", serviceCount: data.serviceIds.length }, { tenantSlug: slug });

    void (async () => {
      if (process.env.VITEST) return;
      try {
        const settings = await getNotificationSettingsForTenant(slug);
        if (settings.smsConfirmationEnabled !== 1) return;
        const appt = await getAppointment(result.id);
        if (!appt?.client?.phone) return;
        const staffDisplayName = await withTenantDb(
          slug,
          async (db, { staff }) => {
            const [s] = await db
              .select({ displayName: staff.displayName })
              .from(staff)
              .where(eq(staff.id, staffId))
              .limit(1);
            return s?.displayName ?? null;
          },
        );
        const staffName =
          staffDisplayName ??
          (await getT("booking", slug))("bookingWizard.staffFallback");
        const tz = await withTenantDb(slug, async (db, { businessSettings }) => {
          const [p] = await db
            .select({ timezone: businessSettings.timezone })
            .from(businessSettings)
            .limit(1);
          return p?.timezone ?? "America/New_York";
        });
        const apptDate = new TZDate(appt.start, tz);
        const dateStr = format(apptDate, "EEEE, MMMM d, yyyy");
        const timeStr = format(apptDate, "h:mm a");
        const serviceNames = appt.services.map((s) => s.serviceName);
        const servicesStr = serviceNames.join(", ");
        const tmpl =
          settings.smsConfirmationBody?.trim() ||
          DEFAULT_SMS_CONFIRMATION_TEMPLATE;
        const body = renderSmsTemplate(tmpl, {
          client: appt.client.name ?? "there",
          staff: staffName,
          date: dateStr,
          time: timeStr,
          services: servicesStr,
        });
        const { sendSms } = await import("@/lib/sms/send");
        await sendSms({
          to: appt.client.phone,
          body,
          tenantSlug: slug,
          clientId,
          appointmentId: result.id,
          messageType: "confirmation",
        });
      } catch (err) {
    if (err instanceof AuthError) throw err;
        console.error("Admin booking SMS confirmation failed:", err);
      }
    })();

    return { success: true as const, id: result.id };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to create booking",
      },
    };
  }
}

async function notifyClientOfMove(
  slug: string,
  appointmentId: string,
  start: Date,
): Promise<boolean> {
  const row = await withTenantDb(
    slug,
    async (db, { appointments, clients, businessSettings }) => {
      const [appt] = await db
        .select({
          clientId: clients.id,
          phone: clients.phone,
        })
        .from(appointments)
        .innerJoin(clients, eq(appointments.clientId, clients.id))
        .where(eq(appointments.id, appointmentId))
        .limit(1);
      const [settings] = await db
        .select({ timezone: businessSettings.timezone })
        .from(businessSettings)
        .limit(1);
      if (!appt?.phone) return null;
      return {
        clientId: appt.clientId,
        phone: appt.phone,
        timezone: settings?.timezone ?? "America/New_York",
      };
    },
  );
  if (!row) return false;
  const t = await getT("schedule", slug);
  const when = new TZDate(start, row.timezone);
  const body = toPlainSms(
    t("move.sms", {
      date: format(when, "EEE MMM d"),
      time: format(when, "h:mm a"),
    }),
  );
  const sent = await sendSms({
    to: row.phone,
    body,
    tenantSlug: slug,
    clientId: row.clientId,
    appointmentId,
    messageType: "reschedule",
  });
  return sent.success;
}

export async function rescheduleBooking(data: {
  appointmentId: string;
  newStartTime: string;
  newStaffId?: string;
  newLocationId?: string | null;
  notifyClient?: boolean;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = rescheduleBookingSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const { appointmentId, newStartTime, newStaffId, newLocationId } =
      parsed.data;

    // Fetch existing appointment to get duration
    const { existing, lineItems } = await withTenantDb(
      slug,
      async (db, { appointments, appointmentServices }) => {
        const [row] = await db
          .select({
            during: appointments.during,
            staffId: appointments.staffId,
            locationId: appointments.locationId,
          })
          .from(appointments)
          .where(
            and(
              eq(appointments.id, appointmentId),
              ne(appointments.status, "cancelled"),
            ),
          )
          .limit(1);
        if (!row) return { existing: undefined, lineItems: [] };
        const items = await db
          .select({
            serviceId: appointmentServices.serviceId,
            durationMinutes: appointmentServices.durationMinutes,
          })
          .from(appointmentServices)
          .where(eq(appointmentServices.appointmentId, appointmentId))
          .limit(50);
        return { existing: row, lineItems: items };
      },
    );

    if (!existing) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Appointment not found or already cancelled",
        },
      };
    }

    // Preserve original duration
    const durationMs =
      existing.during.end.getTime() - existing.during.start.getTime();
    const newStart = new Date(newStartTime);
    const newEnd = new Date(newStart.getTime() + durationMs);

    const targetStaffId = newStaffId ?? existing.staffId;
    // Staff reschedule is an override. A day with no shift still gets a location.
    const resolvedLocation = await resolveBookingLocation(
      slug,
      targetStaffId,
      newStart,
      newLocationId ?? null,
      { allowOffShift: true },
    );

    if (!resolvedLocation) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: (await getT("errors", slug))("appointments.staffUnavailable"),
        },
      };
    }

    // Each attempt re-checks availability (the appointment itself is excluded) and
    // writes the move. If a racing booking takes the chair between the two, the
    // database refuses the write and the next attempt picks another chair.
    const outcome = await withResourceRetry(RESOURCE_RETRY_ATTEMPTS, async () => {
      const guard = await checkBooking({
        slug,
        staffId: targetStaffId,
        start: newStart,
        services: lineItems.map((li) => ({
          serviceId: li.serviceId,
          durationMinutes: li.durationMinutes,
        })),
        totalMinutes: durationMs / 60_000,
        locationId: resolvedLocation.id,
        mode: "reschedule",
        excludeAppointmentIds: [appointmentId],
      });
      if (!guard.ok) return { ok: false as const, code: failureCodeFor(guard.reasons) };

      const updateData: Record<string, unknown> = {
        during: { start: newStart, end: newEnd },
        locationId: resolvedLocation.id,
        updatedAt: new Date(),
      };
      if (newStaffId) {
        updateData.staffId = newStaffId;
      }

      await withTenantDb(slug, async (db, tables) => {
        await db.transaction(async (tx) => {
          await tx
            .update(tables.appointments)
            .set(updateData)
            .where(eq(tables.appointments.id, appointmentId));
          // Frees the old chair and takes the new one in the same transaction.
          await replaceResourceRows(tx, tables, appointmentId, guard.resources);
        });
      });
      return { ok: true as const };
    });

    if (!outcome.ok) {
      const code = outcome.code;
      const message =
        code === "SLOT_TAKEN"
          ? "New time slot conflicts with an existing appointment"
          : code === "BLOCKED"
            ? "New time overlaps a time block — remove or shorten the block first"
            : await failureMessage(code, slug);
      return {
        success: false as const,
        error: { formErrors: [], fieldErrors: {}, message, code },
      };
    }

    await syncAutoAssistantTasksForAppointment(slug, appointmentId);

    // Push reschedule to external calendar (fire-and-forget)
    // Pass slug explicitly since this runs outside request context
    import("@/lib/calendar/sync-tenant").then(({ updateBookingOnCalendarForTenant }) => {
      updateBookingOnCalendarForTenant(slug, appointmentId).catch((err) => {
        console.error(
          "Calendar update failed for rescheduled appointment:",
          appointmentId,
          err,
        );
      });
    });

    revalidatePath("/schedule");
    trackEvent("booking.rescheduled", {}, { tenantSlug: slug });
    const notified = parsed.data.notifyClient
      ? await notifyClientOfMove(slug, appointmentId, newStart)
      : false;
    return { success: true as const, notified };
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    const raceCode = bookingCodeForDbError(error);
    if (raceCode) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message:
            raceCode === "RESOURCE_TAKEN"
              ? await failureMessage("RESOURCE_TAKEN", slug)
              : "New time slot conflicts with an existing appointment",
          code: raceCode,
        },
      };
    }

    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to reschedule booking",
      },
    };
  }
}

export async function updateAppointmentServices(data: {
  appointmentId: string;
  serviceIds: string[];
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateAppointmentServicesSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const { appointmentId, serviceIds } = parsed.data;

    const [existing] = await withTenantDb(slug, async (db, { appointments }) => {
      return db
        .select({
          during: appointments.during,
          staffId: appointments.staffId,
          clientId: appointments.clientId,
          status: appointments.status,
          locationId: appointments.locationId,
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
    });

    if (!existing) {
      return {
        success: false as const,
        error: { formErrors: [], fieldErrors: {}, message: "Appointment not found" },
      };
    }

    if (existing.status === "cancelled" || existing.status === "no_show" || existing.status === "completed") {
      return {
        success: false as const,
        error: { formErrors: [], fieldErrors: {}, message: "Cannot edit a completed, cancelled, or no-show appointment" },
      };
    }

    const durationInfo = await getMultiServiceDuration(
      serviceIds,
      existing.clientId,
      existing.staffId,
    );
    const newEnd = addMinutes(existing.during.start, durationInfo.totalMinutes);

    // The new services may need different rooms or equipment. Admin edits skip
    // the booking rules but never double-book a chair or run into a time block;
    // a lost race re-checks.
    const refused = await withResourceRetry(RESOURCE_RETRY_ATTEMPTS, async () => {
      const guard = await checkBooking({
        slug,
        staffId: existing.staffId,
        start: existing.during.start,
        services: durationInfo.services.map((svc) => ({
          serviceId: svc.serviceId,
          durationMinutes: svc.durationMinutes,
        })),
        totalMinutes: durationInfo.totalMinutes,
        locationId: existing.locationId,
        mode: "override",
        clientId: existing.clientId,
        excludeAppointmentIds: [appointmentId],
      });
      if (!guard.ok) return failureCodeFor(guard.reasons);

      await withTenantDb(slug, async (db, tables) => {
        const { appointments, appointmentServices } = tables;
        await db.transaction(async (tx) => {
          await tx
            .delete(appointmentServices)
            .where(eq(appointmentServices.appointmentId, appointmentId));

          await tx.insert(appointmentServices).values(
            durationInfo.services.map((svc) => ({
              appointmentId,
              serviceId: svc.serviceId,
              durationMinutes: svc.durationMinutes,
              isOverride: svc.isOverride ? 1 : 0,
              priceChargedCents: svc.priceCents,
              activeMinutes: svc.activeMinutes,
              processingMinutes: svc.processingMinutes,
            })),
          );

          await tx
            .update(appointments)
            .set({
              during: { start: existing.during.start, end: newEnd },
              updatedAt: new Date(),
            })
            .where(eq(appointments.id, appointmentId));

          await replaceResourceRows(tx, tables, appointmentId, guard.resources);
        });
      });
      return null;
    });

    if (refused) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: await failureMessage(refused, slug),
          code: refused,
        },
      };
    }

    import("@/lib/calendar/sync-tenant").then(({ updateBookingOnCalendarForTenant }) => {
      updateBookingOnCalendarForTenant(slug, appointmentId).catch((err) => {
        console.error("Calendar update failed for edited appointment:", appointmentId, err);
      });
    });

    await syncAutoAssistantTasksForAppointment(slug, appointmentId);

    revalidatePath("/schedule");
    trackEvent("booking.services_updated", { serviceCount: serviceIds.length }, { tenantSlug: slug });
    return { success: true as const };
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    if (bookingCodeForDbError(error) === "RESOURCE_TAKEN") {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: await failureMessage("RESOURCE_TAKEN", slug),
          code: "RESOURCE_TAKEN" as const,
        },
      };
    }
    return {
      success: false as const,
      error: { formErrors: [], fieldErrors: {}, message: "Failed to update services" },
    };
  }
}

export async function cancelBooking(data: {
  appointmentId: string;
  reason?: string;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = cancelBookingSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {

    // Fetch stylistId for calendar sync before cancellation
    const [appt] = await withTenantDb(slug, async (db, { appointments }) => {
      return db
        .select({ staffId: appointments.staffId })
        .from(appointments)
        .where(eq(appointments.id, parsed.data.appointmentId))
        .limit(1);
    });

    // The status change and any credit given back commit together.
    const result = await withTenantDb(slug, async (db, tables) => {
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(tables.appointments)
          .set({
            status: "cancelled",
            notes: parsed.data.reason ?? null,
            updatedAt: new Date(),
          })
          .where(eq(tables.appointments.id, parsed.data.appointmentId))
          .returning({ id: tables.appointments.id });
        if (rows.length > 0) {
          await refundCreditIfOnTime(tx, tables, {
            appointmentId: parsed.data.appointmentId,
            now: new Date(),
          });
        }
        return rows;
      });
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Appointment not found",
        },
      };
    }

    await syncAutoAssistantTasksForAppointment(slug, parsed.data.appointmentId);

    runAfterResponse(() =>
      import("@/lib/waitlist/opening").then((m) =>
        m.recordOpeningForCancelledAppointment(slug, parsed.data.appointmentId),
      ),
    );

    // Free cancellation (no fee): refund any deposit collected at booking.
    import("@/lib/services/booking-deposits")
      .then(({ refundBookingDepositForTenant }) =>
        refundBookingDepositForTenant(slug, parsed.data.appointmentId),
      )
      .catch((err) =>
        console.error(
          "Deposit refund failed for cancelled appointment:",
          parsed.data.appointmentId,
          err,
        ),
      );

    // Delete from external calendar (fire-and-forget)
    // Pass slug explicitly since this runs outside request context
    if (appt?.staffId) {
      import("@/lib/calendar/sync-tenant").then(
        ({ deleteBookingFromCalendarForTenant }) => {
          deleteBookingFromCalendarForTenant(
            slug,
            parsed.data.appointmentId,
            appt.staffId,
          ).catch((err) => {
            console.error(
              "Calendar delete failed for cancelled appointment:",
              parsed.data.appointmentId,
              err,
            );
          });
        },
      );
    }

    revalidatePath("/schedule");
    trackEvent("booking.cancelled", { hadFee: false }, { tenantSlug: slug });
    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to cancel booking",
      },
    };
  }
}

const deleteBookingSchema = z.object({
  appointmentId: z.string().uuid(),
});

/**
 * Hard-delete an appointment (owner/admin only). Does not set status to cancelled.
 * Removes related charges and form responses first. Calendar event is removed async.
 */
export async function deleteBooking(data: z.infer<typeof deleteBookingSchema>) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = deleteBookingSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  const role = await getUserRole();
  if (role !== "owner" && role !== "admin") {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Only owners and admins can permanently delete a booking",
      },
    };
  }

  try {
    const { appointmentId } = parsed.data;

    const [existing] = await withTenantDb(slug, async (db, { appointments }) => {
      return db
        .select({
          id: appointments.id,
          staffId: appointments.staffId,
          status: appointments.status,
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);
    });

    if (!existing) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Appointment not found",
        },
      };
    }

    if (existing.status === "completed") {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message:
            "Cannot delete a completed appointment. Use refunds or support if this was a mistake.",
        },
      };
    }

    await withTenantDb(
      slug,
      async (db, tables) => {
        const { charges, formResponses, smsMessages, appointments } = tables;
        await db.transaction(async (tx) => {
          // A booking removed as a mistake is never a late cancel: the credit goes back
          // (the ledger row would otherwise lose its booking link and the credit would be lost).
          await refundCreditIfOnTime(tx, tables, { appointmentId, now: new Date(), ignoreWindow: true });
          await tx.delete(charges).where(eq(charges.appointmentId, appointmentId));
          await tx
            .delete(formResponses)
            .where(eq(formResponses.appointmentId, appointmentId));
          await tx
            .update(smsMessages)
            .set({ appointmentId: null, updatedAt: new Date() })
            .where(eq(smsMessages.appointmentId, appointmentId));
          await tx.delete(appointments).where(eq(appointments.id, appointmentId));
        });
      },
    );

    import("@/lib/calendar/sync-tenant").then(
      ({ deleteBookingFromCalendarForTenant }) => {
        deleteBookingFromCalendarForTenant(
          slug,
          appointmentId,
          existing.staffId,
        ).catch((err) => {
          console.error("Calendar delete failed for deleted appointment:", appointmentId, err);
        });
      },
    );

    revalidatePath("/schedule");
    trackEvent("booking.deleted", {}, { tenantSlug: slug });
    return { success: true as const };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    console.error("deleteBooking", e);
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to delete booking",
      },
    };
  }
}

export async function cancelBookingWithFee(data: {
  appointmentId: string;
  reason?: string;
  skipFee?: boolean;
}) {
  const { tenantSlug: slug } = await requireStaff();
  if (data.skipFee) {
    return cancelBooking({
      appointmentId: data.appointmentId,
      reason: data.reason,
    });
  }

  // Dynamic import to avoid circular dependency
  const { chargeCancellationFee } = await import("@/actions/charges");
  const feeResult = await chargeCancellationFee(data.appointmentId);

  // If fee was charged or outside window, the cancellation is handled by chargeCancellationFee
  if (feeResult.success) {
    if ("feeCharged" in feeResult && !feeResult.feeCharged) {
      // Outside window or $0 fee -- cancel without fee was already called inside chargeCancellationFee
      // unless the reason is "Outside cancellation window", in which case we still need to cancel
      if (feeResult.reason === "Outside cancellation window") {
        await cancelBooking({
          appointmentId: data.appointmentId,
          reason: data.reason,
        });
      }
    }
    trackEvent("booking.cancelled", { hadFee: true }, { tenantSlug: slug });
    return { success: true as const, feeResult };
  }

  return { success: false as const, error: feeResult.error };
}

export async function getAppointmentsForDateRange(
  staffId: string,
  startDate: Date,
  endDate: Date,
) {
  const { tenantSlug: slug } = await requireStaff();
  const rangeStr = `[${startDate.toISOString()},${endDate.toISOString()})`;

  return withTenantDb(slug, async (db, { appointments, appointmentServices, clients, services, locations }) => {
    const rows = await db
      .select({
        id: appointments.id,
        during: appointments.during,
        status: appointments.status,
        notes: appointments.notes,
        calendarSyncStatus: appointments.calendarSyncStatus,
        clientName: clients.name,
        clientId: clients.id,
        stripePaymentMethodId: clients.stripePaymentMethodId,
        locationId: locations.id,
        locationName: locations.name,
        locationAddress: locations.address,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(locations, eq(appointments.locationId, locations.id))
      .where(
        and(
          eq(appointments.staffId, staffId),
          ne(appointments.status, "cancelled"),
          sql`${appointments.during} && ${rangeStr}::tstzrange`,
        ),
      )
      .orderBy(asc(sql`lower(${appointments.during})`));

    // Batch-fetch services for all appointments in a single query
    const appointmentIds = rows.map((r) => r.id);
    const servicesMap = await getServicesForAppointments(db, { appointmentServices, services }, appointmentIds);

    const apptServiceRows = appointmentIds.length > 0
      ? await db
          .select({
            appointmentId: appointmentServices.appointmentId,
            activeMinutesSnapshot: appointmentServices.activeMinutes,
            processingMinutesSnapshot: appointmentServices.processingMinutes,
            activeMinutesDefault: services.activeMinutes,
            processingMinutesDefault: services.processingMinutes,
          })
          .from(appointmentServices)
          .innerJoin(services, eq(appointmentServices.serviceId, services.id))
          .where(inArray(appointmentServices.appointmentId, appointmentIds))
      : [];

    const processingInfoMap = new Map<string, { activeMinutes: number | null; processingMinutes: number | null }>();
    for (const row of apptServiceRows) {
      if (!processingInfoMap.has(row.appointmentId)) {
        processingInfoMap.set(row.appointmentId, {
          activeMinutes: row.activeMinutesSnapshot ?? row.activeMinutesDefault,
          processingMinutes:
            row.processingMinutesSnapshot ?? row.processingMinutesDefault,
        });
      }
    }

    return rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      clientName: row.clientName,
      services: servicesMap.get(row.id) ?? [],
      start: row.during.start,
      end: row.during.end,
      status: row.status,
      notes: row.notes,
      hasCardOnFile: !!row.stripePaymentMethodId,
      calendarSyncStatus: row.calendarSyncStatus,
      locationId: row.locationId,
      locationName: row.locationName,
      locationAddress: row.locationAddress,
      activeMinutes: processingInfoMap.get(row.id)?.activeMinutes ?? null,
      processingMinutes:
        processingInfoMap.get(row.id)?.processingMinutes ?? null,
    }));
  });
}

/**
 * Consolidated schedule data fetch for schedule views.
 * Fetches all appointments + services + external events for multiple stylists
 * in a single server action call (replaces N per-stylist calls).
 */
export async function getScheduleData(
  staffIds: string[],
  startDate: Date,
  endDate: Date,
) {
  const { tenantSlug: slug } = await requireStaff();
  if (staffIds.length === 0) {
    return {
      appointments: {} as Record<string, unknown[]>,
      externalEvents: {} as Record<string, unknown[]>,
      timeBlocks: {} as Record<string, unknown[]>,
    };
  }

  const rangeStr = `[${startDate.toISOString()},${endDate.toISOString()})`;

  return withTenantDb(slug, async (db, { appointments, appointmentServices, clients, clientServiceOverrides, services, externalEvents, locations, timeBlocks, recurrenceRules, clientAddresses, projects }) => {
    // Initialize empty arrays for all stylistIds
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const appointmentsByStylelist: Record<string, any[]> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const externalEventsByStaffMember: Record<string, any[]> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const timeBlocksByStaffMember: Record<string, any[]> = {};
    for (const id of staffIds) {
      appointmentsByStylelist[id] = [];
      externalEventsByStaffMember[id] = [];
      timeBlocksByStaffMember[id] = [];
    }

    // 1. Fetch ALL stylists' appointments in one query
    const rows = await db
      .select({
        id: appointments.id,
        staffId: appointments.staffId,
        during: appointments.during,
        status: appointments.status,
        notes: appointments.notes,
        attributes: appointments.attributes,
        checkedInAt: appointments.checkedInAt,
        calendarSyncStatus: appointments.calendarSyncStatus,
        isDoubleBook: appointments.isDoubleBook,
        doubleBookParentAppointmentId: appointments.doubleBookParentAppointmentId,
        clientStatusAtBooking: appointments.clientStatusAtBooking,
        recurrenceRuleId: appointments.recurrenceRuleId,
        bookingGroupId: appointments.bookingGroupId,
        rrule: recurrenceRules.rrule,
        clientName: clients.name,
        clientId: clients.id,
        stripePaymentMethodId: clients.stripePaymentMethodId,
        locationId: locations.id,
        locationName: locations.name,
        locationAddress: locations.address,
        arrivalWindowMin: appointments.arrivalWindowMin,
        onMyWaySentAt: appointments.onMyWaySentAt,
        addressLine1: clientAddresses.line1,
        addressLine2: clientAddresses.line2,
        addressCity: clientAddresses.city,
        addressRegion: clientAddresses.region,
        addressPostalCode: clientAddresses.postalCode,
        projectId: projects.id,
        projectTitle: projects.title,
        projectDesignAttachmentId: projects.designAttachmentId,
        projectDesignApprovedAt: projects.designApprovedAt,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .leftJoin(locations, eq(appointments.locationId, locations.id))
      .leftJoin(recurrenceRules, eq(appointments.recurrenceRuleId, recurrenceRules.id))
      .leftJoin(clientAddresses, eq(appointments.serviceAddressId, clientAddresses.id))
      .leftJoin(projects, eq(appointments.projectId, projects.id))
      .where(
        and(
          inArray(appointments.staffId, staffIds),
          ne(appointments.status, "cancelled"),
          sql`${appointments.during} && ${rangeStr}::tstzrange`,
        ),
      )
      .orderBy(asc(sql`lower(${appointments.during})`));

    // 2. Batch-fetch services for all returned appointments
    const appointmentIds = rows.map((r) => r.id);
    const servicesMap = await getServicesForAppointments(db, { appointmentServices, services }, appointmentIds);

    // 2a. Apply per-client overrides on top of the snapshot pricing/duration
    // returned above. The schedule view shows current per-client overrides
    // (rather than purely historical snapshots) so revenue + hours-booked
    // totals match what the stylist sees in the client profile.
    //
    // Resolution: client_service_override > appointment snapshot > catalog.
    const apptIdToClientId = new Map<string, string>();
    for (const row of rows) apptIdToClientId.set(row.id, row.clientId);
    const overridePairs: { clientId: string; serviceId: string }[] = [];
    const seenPair = new Set<string>();
    for (const [apptId, svcs] of servicesMap.entries()) {
      const clientId = apptIdToClientId.get(apptId);
      if (!clientId) continue;
      for (const svc of svcs) {
        const key = `${clientId}::${svc.serviceId}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        overridePairs.push({ clientId, serviceId: svc.serviceId });
      }
    }
    if (overridePairs.length > 0) {
      const overrideClientIds = [...new Set(overridePairs.map((p) => p.clientId))];
      const overrideServiceIds = [...new Set(overridePairs.map((p) => p.serviceId))];
      const overrideRows = await db
        .select({
          clientId: clientServiceOverrides.clientId,
          serviceId: clientServiceOverrides.serviceId,
          priceCents: clientServiceOverrides.priceCents,
          durationMinutes: clientServiceOverrides.durationMinutes,
        })
        .from(clientServiceOverrides)
        .where(
          and(
            inArray(clientServiceOverrides.clientId, overrideClientIds),
            inArray(clientServiceOverrides.serviceId, overrideServiceIds),
          ),
        );
      const overrideByPair = new Map<
        string,
        { priceCents: number | null; durationMinutes: number | null }
      >();
      for (const o of overrideRows) {
        overrideByPair.set(`${o.clientId}::${o.serviceId}`, {
          priceCents: o.priceCents,
          durationMinutes: o.durationMinutes,
        });
      }
      for (const [apptId, svcs] of servicesMap.entries()) {
        const clientId = apptIdToClientId.get(apptId);
        if (!clientId) continue;
        const next = svcs.map((svc) => {
          const ov = overrideByPair.get(`${clientId}::${svc.serviceId}`);
          if (!ov) return svc;
          return {
            ...svc,
            priceCents: ov.priceCents ?? svc.priceCents,
            durationMinutes: ov.durationMinutes ?? svc.durationMinutes,
            isOverride: ov.durationMinutes != null ? 1 : svc.isOverride,
          };
        });
        servicesMap.set(apptId, next);
      }
    }

    const parentIds = [
      ...new Set(
        rows
          .map((r) => r.doubleBookParentAppointmentId)
          .filter((id): id is string => id != null),
      ),
    ];
    const flexParentClientNameById = new Map<string, string>();
    if (parentIds.length > 0) {
      const parentRows = await db
        .select({
          id: appointments.id,
          clientName: clients.name,
        })
        .from(appointments)
        .innerJoin(clients, eq(appointments.clientId, clients.id))
        .where(inArray(appointments.id, parentIds));
      for (const pr of parentRows) {
        flexParentClientNameById.set(pr.id, pr.clientName);
      }
    }

    // 2b. Batch-fetch primary service processing time info
    // For each appointment, get activeMinutes/processingMinutes from its primary service
    const apptServiceRows = appointmentIds.length > 0
      ? await db
          .select({
            appointmentId: appointmentServices.appointmentId,
            activeMinutesSnapshot: appointmentServices.activeMinutes,
            processingMinutesSnapshot: appointmentServices.processingMinutes,
            activeMinutesDefault: services.activeMinutes,
            processingMinutesDefault: services.processingMinutes,
          })
          .from(appointmentServices)
          .innerJoin(services, eq(appointmentServices.serviceId, services.id))
          .where(inArray(appointmentServices.appointmentId, appointmentIds))
      : [];

    // Build map of appointmentId -> first service's processing time
    const processingInfoMap = new Map<string, { activeMinutes: number | null; processingMinutes: number | null }>();
    for (const row of apptServiceRows) {
      if (!processingInfoMap.has(row.appointmentId)) {
        processingInfoMap.set(row.appointmentId, {
          activeMinutes: row.activeMinutesSnapshot ?? row.activeMinutesDefault,
          processingMinutes:
            row.processingMinutesSnapshot ?? row.processingMinutesDefault,
        });
      }
    }

    // 3. Group appointments by stylistId
    for (const row of rows) {
      const processingInfo = processingInfoMap.get(row.id);
      appointmentsByStylelist[row.staffId].push({
        id: row.id,
        staffId: row.staffId,
        clientId: row.clientId,
        clientName: row.clientName,
        services: servicesMap.get(row.id) ?? [],
        start: row.during.start,
        end: row.during.end,
        status: row.status,
        notes: row.notes,
        attributes: row.attributes ?? {},
        checkedInAt: row.checkedInAt,
        hasCardOnFile: !!row.stripePaymentMethodId,
        calendarSyncStatus: row.calendarSyncStatus,
        isDoubleBook: row.isDoubleBook === 1,
        doubleBookParentAppointmentId: row.doubleBookParentAppointmentId,
        doubleBookParentClientName: row.doubleBookParentAppointmentId
          ? flexParentClientNameById.get(row.doubleBookParentAppointmentId) ??
            null
          : null,
        clientStatusAtBooking: row.clientStatusAtBooking ?? null,
        recurrenceRuleId: row.recurrenceRuleId,
        bookingGroupId: row.bookingGroupId,
        rrule: row.rrule ?? null,
        locationId: row.locationId,
        locationName: row.locationName,
        locationAddress: row.locationAddress,
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
        project: row.projectId
          ? {
              id: row.projectId,
              title: row.projectTitle ?? "",
              designPending: row.projectDesignAttachmentId != null && row.projectDesignApprovedAt == null,
            }
          : null,
        activeMinutes: processingInfo?.activeMinutes ?? null,
        processingMinutes: processingInfo?.processingMinutes ?? null,
      });
    }

    // 4. Fetch ALL stylists' external events in one query
    const externalRows = await db
      .select({
        id: externalEvents.id,
        staffId: externalEvents.staffId,
        startTime: externalEvents.startTime,
        endTime: externalEvents.endTime,
        isAllDay: externalEvents.isAllDay,
        freeBusyStatus: externalEvents.freeBusyStatus,
      })
      .from(externalEvents)
      .where(
        and(
          inArray(externalEvents.staffId, staffIds),
          lt(externalEvents.startTime, endDate),
          gt(externalEvents.endTime, startDate),
        ),
      );

    // 5. Group external events by stylistId
    for (const row of externalRows) {
      externalEventsByStaffMember[row.staffId].push({
        id: row.id,
        startTime: row.startTime,
        endTime: row.endTime,
        isAllDay: row.isAllDay,
        freeBusyStatus: row.freeBusyStatus,
      });
    }

    // 6. Time blocks (internal busy)
    const timeBlockRows = await db
      .select({
        id: timeBlocks.id,
        staffId: timeBlocks.staffId,
        during: timeBlocks.during,
        label: timeBlocks.label,
      })
      .from(timeBlocks)
      .where(
        and(
          inArray(timeBlocks.staffId, staffIds),
          sql`${timeBlocks.during} && ${rangeStr}::tstzrange`,
        ),
      );

    for (const row of timeBlockRows) {
      timeBlocksByStaffMember[row.staffId].push({
        id: row.id,
        startTime: row.during.start,
        endTime: row.during.end,
        label: row.label,
      });
    }

    return {
      appointments: appointmentsByStylelist,
      externalEvents: externalEventsByStaffMember,
      timeBlocks: timeBlocksByStaffMember,
    };
  });
}

const PLACE_KINDS = ["room", "chair", "station"] as const;

export async function getRoomDay(startDate: Date, endDate: Date) {
  const { tenantSlug: slug } = await requireStaff();
  const rangeStr = `[${startDate.toISOString()},${endDate.toISOString()})`;

  return withTenantDb(slug, async (db, tables) => {
    const {
      resources,
      appointmentResources,
      appointments,
      clients,
      appointmentServices,
      services,
    } = tables;
    const rooms = await db
      .select({
        id: resources.id,
        name: resources.name,
        kind: resources.kind,
      })
      .from(resources)
      .where(and(eq(resources.isActive, 1), inArray(resources.kind, [...PLACE_KINDS])))
      .orderBy(asc(resources.name), asc(resources.id));

    const appointmentsByRoom: Record<string, unknown[]> = {};
    for (const room of rooms) appointmentsByRoom[room.id] = [];
    if (rooms.length === 0) return { rooms, appointments: appointmentsByRoom };

    const rows = await db
      .select({
        resourceId: appointmentResources.resourceId,
        id: appointments.id,
        staffId: appointments.staffId,
        during: appointmentResources.during,
        status: appointments.status,
        checkedInAt: appointments.checkedInAt,
        notes: appointments.notes,
        clientName: clients.name,
        clientId: clients.id,
      })
      .from(appointmentResources)
      .innerJoin(appointments, eq(appointmentResources.appointmentId, appointments.id))
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .where(
        and(
          inArray(
            appointmentResources.resourceId,
            rooms.map((room) => room.id),
          ),
          ne(appointments.status, "cancelled"),
          sql`${appointmentResources.during} && ${rangeStr}::tstzrange`,
        ),
      );

    const servicesMap = await getServicesForAppointments(
      db,
      { appointmentServices, services },
      [...new Set(rows.map((row) => row.id))],
    );

    for (const row of rows) {
      appointmentsByRoom[row.resourceId].push({
        id: row.id,
        staffId: row.staffId,
        clientId: row.clientId,
        clientName: row.clientName,
        services: servicesMap.get(row.id) ?? [],
        start: row.during.start,
        end: row.during.end,
        status: row.status,
        checkedInAt: row.checkedInAt,
        notes: row.notes,
      });
    }

    return { rooms, appointments: appointmentsByRoom };
  });
}

export async function checkInAppointment(id: string) {
  const { tenantSlug: slug } = await requireStaff();
  if (!z.string().uuid().safeParse(id).success) {
    return { success: false as const, error: { message: "Invalid booking" } };
  }

  const now = new Date();
  const checkedInAt = await withTenantDb(slug, async (db, { appointments }) => {
    const [row] = await db
      .select({ at: appointments.checkedInAt })
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);
    if (!row) return undefined;
    const next = applyCheckIn(row.at, now);
    if (next.changed) {
      await db
        .update(appointments)
        .set({ checkedInAt: next.at, updatedAt: now })
        .where(and(eq(appointments.id, id), isNull(appointments.checkedInAt)));
      const [fresh] = await db
        .select({ at: appointments.checkedInAt })
        .from(appointments)
        .where(eq(appointments.id, id))
        .limit(1);
      return fresh?.at ?? next.at;
    }
    return next.at;
  });

  if (!checkedInAt) {
    const t = await getT("schedule", slug);
    return { success: false as const, error: { message: t("checkInMissing") } };
  }

  revalidatePath("/schedule");
  return { success: true as const, checkedInAt: checkedInAt.toISOString() };
}

export async function sendClientText(appointmentId: string, body: string) {
  const { tenantSlug: slug } = await requireStaff();
  const t = await getT("schedule", slug);
  if (!z.string().uuid().safeParse(appointmentId).success) {
    return { success: false as const, error: { message: t("checkInMissing") } };
  }

  const prepared = prepareManualSms(body);
  if (!prepared.ok) {
    return {
      success: false as const,
      error: {
        message: prepared.error === "too_long" ? t("textDialog.tooLong") : t("textDialog.empty"),
      },
    };
  }

  const client = await withTenantDb(slug, async (db, { appointments, clients }) => {
    const [row] = await db
      .select({
        clientId: clients.id,
        phone: clients.phone,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    return row ?? null;
  });

  if (!client?.phone) {
    return { success: false as const, error: { message: t("textDialog.noPhone") } };
  }

  const sent = await sendSms({
    to: client.phone,
    body: prepared.body,
    tenantSlug: slug,
    clientId: client.clientId,
    appointmentId,
    messageType: "manual",
  });

  if (!sent.success) {
    if (sent.error === "no_consent") {
      return { success: false as const, error: { message: t("textDialog.noConsent") } };
    }
    if (sent.error === "quiet_hours") {
      return { success: false as const, error: { message: t("textDialog.quietHours") } };
    }
    return { success: false as const, error: { message: t("textDialog.failed") } };
  }

  return { success: true as const };
}

export async function getAppointment(id: string) {
  const { tenantSlug: slug } = await requireStaff();
  return loadAppointmentForTenant(slug, id);
}
