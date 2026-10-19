"use server";

import { getT } from "@/lib/terms/server";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { eq, and, asc, desc, ne, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getMultiServiceDuration } from "@/lib/services/duration";
import {
  canClientBookService,
  isNewClient,
} from "@/lib/services/booking-audience";
import {
  checkBooking,
  listBookableDays,
  listDaySlots,
  resolveBookingLocation,
} from "@/lib/scheduling/service";
import { loadSchedulingSettings, loadStaffNames } from "@/lib/scheduling/load";
import { localDay } from "@/lib/scheduling/intervals";
import { bookAppointment } from "@/lib/booking/book";
import { failureMessage } from "@/lib/booking/failure-message";
import { getServicesForAppointment } from "@/lib/queries/appointment-services";
import { syncAutoAssistantTasksForAppointment } from "@/lib/services/sync-auto-assistant-tasks";
import { isExternalSlotAvailable } from "@/actions/calendar-sync";
import { pushBookingToCalendarForTenant } from "@/lib/calendar/sync-tenant";
import { getServicesForStaff } from "@/lib/queries/staff-services";
import { trackEvent } from "@/lib/analytics/events";
import { sendBookingConfirmations } from "@/lib/booking/confirmations";
import { hasModule } from "@/lib/tenant/modules";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { addressInputSchema, insertClientAddress, judgeAddress } from "@/lib/on-site/addresses";
import { loadServiceTiming } from "@/lib/scheduling/load";
import { findRedeemablePackage, redeemForAppointment } from "@/lib/credits/ledger";
import { enforceAgeGate, getAgeGate, parseDob, type AgeGate } from "@/lib/consent/gate";

/**
 * Look up a business by its URL slug.
 * Queries the tenants table (the canonical registry of all businesses).
 */
export async function getBusinessBySlug(
  slug: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  const [tenant] = await publicDb
    .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  return tenant ?? null;
}

/**
 * Get active staff members with assigned services for a business.
 * Only includes staff members who have at least one assigned service.
 */
export async function getBookingStaff() {
  const slug = await getTenantSlug();
  return withTenantDb(slug, async (db, { staff, staffServices, services }) => {
    const allStaff = await db
      .select()
      .from(staff)
      .where(eq(staff.isActive, 1))
      .orderBy(asc(staff.displayName));

    const staffIds = allStaff.map((s) => s.id);
    const servicesMap = await getServicesForStaff(db, { staffServices, services }, staffIds);

    const staffWithServices = allStaff.map((staffMember) => ({
      id: staffMember.id,
      displayName: staffMember.displayName,
      photoUrl: staffMember.photoUrl,
      bio: staffMember.bio,
      services: servicesMap.get(staffMember.id) ?? [],
    }));

    // Filter to only staff members with at least one service
    return staffWithServices.filter((s) => s.services.length > 0);
  });
}

/**
 * Get services this staff member offers, with per-client + per-staff resolved
 * durations and prices.
 *
 * Hidden offerings (`staff_services.is_offered = 0`) are filtered out.
 * Resolution chain: client_service_overrides → staff_services → services.
 * `"any"` returns the union of services offered by active staff, resolved
 * without a staff member (so no per-staff override applies).
 */
export async function getStaffServices(
  staffId: string | "any",
  clientId: string | null,
): Promise<{
  services: Array<{
    serviceId: string;
    serviceName: string;
    durationMinutes: number;
    priceCents: number;
    category: string;
    priceDisplay: string;
    isPriceOverride: boolean;
  }>;
  /** True when audience filtering hid services from a first-time client. */
  hiddenForNewClient: boolean;
}> {
  const sessionClientId = await getBookingSession();
  const trustedClientId = clientId && clientId === sessionClientId ? clientId : null;
  const slug = await getTenantSlug();
  const isAny = staffId === "any";
  return withTenantDb(slug, async (db, { staffServices, services, clients, staff }) => {
    const assigned = isAny
      ? await db
          .selectDistinct({ serviceId: staffServices.serviceId })
          .from(staffServices)
          .innerJoin(staff, eq(staff.id, staffServices.staffId))
          .where(and(eq(staff.isActive, 1), eq(staffServices.isOffered, 1)))
      : await db
          .select({ serviceId: staffServices.serviceId })
          .from(staffServices)
          .where(
            and(
              eq(staffServices.staffId, staffId),
              eq(staffServices.isOffered, 1),
            ),
          );
    const serviceIds = assigned.map((a) => a.serviceId);
    if (serviceIds.length === 0)
      return { services: [], hiddenForNewClient: false };

    // Filter to only services that are still active (not soft-deleted).
    const activeIds = (
      await db
        .select({ id: services.id })
        .from(services)
        .where(
          and(eq(services.isActive, 1), inArray(services.id, serviceIds)),
        )
    ).map((r) => r.id);

    if (activeIds.length === 0)
      return { services: [], hiddenForNewClient: false };

    // New-vs-returning for per-service audience rules. An unknown client is
    // treated as new (most restrictive; can't happen post-identity anyway).
    let isNew = true;
    if (trustedClientId) {
      const [clientRow] = await db
        .select({ appointmentsBooked: clients.appointmentsBooked })
        .from(clients)
        .where(eq(clients.id, trustedClientId))
        .limit(1);
      isNew = isNewClient(clientRow?.appointmentsBooked);
    }

    const result = await getMultiServiceDuration(activeIds, trustedClientId, isAny ? null : staffId);
    // Internal-only services (online_bookable = 0) are staff-bookable but
    // never shown as a self-bookable option on the public booking page.
    const onlineList = result.services.filter((svc) => svc.onlineBookable !== 0);
    const eligible = onlineList.filter((svc) =>
      canClientBookService(svc.bookingAudience, isNew),
    );

    return {
      services: eligible.map((svc) => ({
        serviceId: svc.serviceId,
        serviceName: svc.serviceName,
        durationMinutes: svc.durationMinutes,
        priceCents: svc.priceCents,
        category: svc.category,
        priceDisplay: svc.priceDisplay,
        isPriceOverride: svc.isPriceOverride,
      })),
      hiddenForNewClient: isNew && eligible.length < onlineList.length,
    };
  });
}

/**
 * Service IDs from the client's most recent appointment, used to offer a
 * one-tap "book again" shortcut on the services step.
 *
 * Prefers appointments with the selected staff member, then past visits over
 * upcoming ones, then recency. Cancelled appointments are ignored. Returns
 * raw IDs; the caller intersects them with the services the staff member
 * currently offers (so audience/active/online-bookable rules still apply).
 */
export async function getRecentClientServices(
  clientId: string,
  staffId: string | "any",
): Promise<{ serviceIds: string[]; visitDate: string | null }> {
  const sessionClientId = await getBookingSession();
  if (!sessionClientId || sessionClientId !== clientId) {
    return { serviceIds: [], visitDate: null };
  }
  const slug = await getTenantSlug();
  return withTenantDb(slug, async (db, { appointments, appointmentServices }) => {
    const [recent] = await db
      .select({
        id: appointments.id,
        serviceId: appointments.serviceId,
        during: appointments.during,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clientId, clientId),
          ne(appointments.status, "cancelled"),
        ),
      )
      .orderBy(
        // "Anyone available" has no staff member to prefer (and "any" is not a uuid).
        ...(staffId === "any" ? [] : [desc(sql`(${appointments.staffId} = ${staffId})`)]),
        desc(sql`(lower(${appointments.during}) <= now())`),
        desc(sql`lower(${appointments.during})`),
      )
      .limit(1);

    if (!recent) return { serviceIds: [], visitDate: null };

    // Line items are the source of truth; single-service legacy rows only
    // have appointments.service_id.
    const lineItems = await db
      .select({ serviceId: appointmentServices.serviceId })
      .from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, recent.id));

    const serviceIds =
      lineItems.length > 0
        ? lineItems.map((li) => li.serviceId)
        : recent.serviceId
          ? [recent.serviceId]
          : [];

    const start = recent.during.start;
    return {
      serviceIds,
      // Only label the card with a date for actual past visits.
      visitDate:
        start && start.getTime() <= Date.now() ? start.toISOString() : null,
    };
  });
}

/** True when the on_site module is on and any chosen service is performed at the client's address. */
async function needsAddress(slug: string, serviceIds: string[]): Promise<boolean> {
  if (serviceIds.length === 0) return false;
  if (!(await hasModule(slug, "on_site"))) return false;
  const timing = await loadServiceTiming(slug, serviceIds);
  return timing.some((s) => s.locationType === "on_site");
}

/** Public: does the booking wizard need to ask where to come? */
export async function servicesNeedAddress(serviceIds: string[]): Promise<boolean> {
  const parsed = z.array(z.string().uuid()).max(20).safeParse(serviceIds);
  if (!parsed.success) return false;
  return needsAddress(await getTenantSlug(), parsed.data);
}

/**
 * Public: saves the signed-in client's address after checking the business travels there.
 * The address needs coordinates (from its ZIP code) so travel time can be worked out.
 */
export async function saveClientAddressPublic(
  input: unknown,
): Promise<{ success: true; addressId: string } | { success: false; error: string }> {
  const slug = await getTenantSlug();
  const [t, tr] = await Promise.all([getT("booking", slug), getT("requests", slug)]);
  const clientId = await getBookingSession();
  if (!clientId) return { success: false, error: tr("signInFirst") };
  const parsed = addressInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: tr("required") };
  if (!(await hasModule(slug, "on_site"))) return { success: false, error: tr("invalid") };

  const verdict = await judgeAddress(slug, parsed.data.postalCode, null);
  if (verdict.result === "out_of_area") {
    return { success: false, error: tr("outOfArea", { zip: verdict.zip }) };
  }
  if (!verdict.point) return { success: false, error: t("addressStep.notFound") };
  const addressId = await insertClientAddress(slug, clientId, parsed.data, verdict.point);
  return { success: true, addressId };
}

/**
 * Public: the minimum-age rule for these services (null when there is none), and
 * whether the signed-in client's birthday is already on file. The confirm step
 * asks for a date of birth only when there is a rule and no birthday.
 */
export async function getAgeGateForServices(
  serviceIds: string[],
): Promise<{ gate: AgeGate | null; birthdayKnown: boolean }> {
  const parsed = z.array(z.string().uuid()).max(20).safeParse(serviceIds);
  if (!parsed.success) return { gate: null, birthdayKnown: false };
  const slug = await getTenantSlug();
  const gate = await getAgeGate(slug, parsed.data);
  if (!gate) return { gate: null, birthdayKnown: false };
  const clientId = await getBookingSession();
  if (!clientId) return { gate, birthdayKnown: false };
  const [row] = await withTenantDb(slug, async (db, { clients }) =>
    db.select({ birthday: clients.birthday }).from(clients).where(eq(clients.id, clientId)).limit(1),
  );
  return { gate, birthdayKnown: !!parseDob(row?.birthday) };
}

const slotParams = z.object({
  staffId: z.union([z.string().uuid(), z.literal("any")]),
  serviceIds: z.array(z.string().uuid()).min(1).max(20),
  locationId: z.string().uuid().nullable(),
  clientId: z.string().uuid().nullable(),
  serviceAddressId: z.string().uuid().nullable().optional(),
});

/**
 * Days in the booking horizon that have at least one bookable slot for the
 * staff member and services. The time zone comes from business settings.
 */
export async function getAvailableDates(params: {
  staffId: string;
  serviceIds: string[];
  locationId: string | null;
  clientId: string | null;
  serviceAddressId?: string | null;
}) {
  const sessionClientId = await getBookingSession();
  const parsed = slotParams.safeParse({
    ...params,
    clientId: params.clientId === sessionClientId ? params.clientId : null,
  });
  if (!parsed.success) return [];
  const slug = await getTenantSlug();
  const days = await listBookableDays({ slug, ...parsed.data });
  return days.map((date) => ({ date, hasSlots: true }));
}

/**
 * Bookable start times (ISO strings) for a staff member on a local date.
 * Flex slots (during another appointment's processing window) are flagged.
 */
export async function getAvailableSlots(params: {
  staffId: string;
  serviceIds: string[];
  locationId: string | null;
  clientId: string | null;
  serviceAddressId?: string | null;
  date: string;
}) {
  const sessionClientId = await getBookingSession();
  const parsed = slotParams.safeParse({
    ...params,
    clientId: params.clientId === sessionClientId ? params.clientId : null,
  });
  if (!parsed.success || typeof params.date !== "string") return [];
  const slug = await getTenantSlug();
  const slots = await listDaySlots({ slug, ...parsed.data, day: params.date });
  const names = await loadStaffNames(slug, slots.map((s) => s.staffId));
  return slots.map((s) => ({
    time: s.start.toISOString(),
    isDoubleBook: s.isFlex,
    doubleBookParentAppointmentId: s.hostAppointmentId ?? null,
    staffId: s.staffId,
    staffName: names[s.staffId] ?? null,
  }));
}

/**
 * Spends one credit on a just-booked appointment and clears its deposit, in one transaction.
 * Only the signed-in client can spend their own credits. False when the module is off, the
 * caller is not that client, or no package fits (the booking is kept either way).
 */
async function applyBookingCredit(
  slug: string,
  clientId: string,
  serviceIds: string[],
  appointmentId: string,
): Promise<boolean> {
  try {
    if (!(await hasModule(slug, "packages"))) return false;
    if ((await getBookingSession()) !== clientId) return false;
    return await withTenantDb(slug, (db, tables) =>
      db.transaction(async (tx) => {
        const ledgerId = await redeemForAppointment(tx, tables, { clientId, serviceIds, appointmentId });
        if (!ledgerId) return false;
        await tx
          .update(tables.appointments)
          .set({ depositCents: 0, updatedAt: new Date() })
          .where(eq(tables.appointments.id, appointmentId));
        return true;
      }),
    );
  } catch (err) {
    console.error("Credit redemption failed for appointment:", appointmentId, err);
    return false;
  }
}

/**
 * Public: the credit the signed-in client could use for these services, or null.
 * Powers the "Use 1 credit from {name} ({remaining} left)" checkbox on the confirm step.
 */
export async function getCreditOption(
  serviceIds: string[],
): Promise<{ name: string; remaining: number } | null> {
  const parsed = z.array(z.string().uuid()).min(1).max(20).safeParse(serviceIds);
  if (!parsed.success) return null;
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, "packages"))) return null;
  const clientId = await getBookingSession();
  if (!clientId) return null;
  return withTenantDb(slug, async (db, tables) => {
    const pkg = await findRedeemablePackage(db, tables, {
      clientId,
      serviceIds: parsed.data,
      at: new Date(),
      lock: false,
    });
    return pkg ? { name: pkg.name, remaining: pkg.creditsRemaining } : null;
  });
}

/**
 * Public: after the client is known, ask whether the quoted slot still fits
 * their real visit length. "any" and signed-out callers skip the check.
 * A visit that is not longer than the quote is left to confirmBooking.
 */
export async function recheckPublicSlot(input: {
  staffId: string;
  serviceIds: string[];
  locationId: string | null;
  serviceAddressId?: string | null;
  startTime: string;
  quotedMinutes: number;
}): Promise<{ ok: true } | { ok: false; reason: "duration" }> {
  try {
    const sessionClientId = await getBookingSession();
    if (!sessionClientId) return { ok: true };
    const staffId = z.string().uuid().safeParse(input.staffId);
    const serviceIds = z.array(z.string().uuid()).min(1).max(20).safeParse(input.serviceIds);
    if (!staffId.success || !serviceIds.success) return { ok: true };
    const slug = await getTenantSlug();
    const duration = await getMultiServiceDuration(
      serviceIds.data,
      sessionClientId,
      staffId.data,
      slug,
    );
    if (duration.totalMinutes <= input.quotedMinutes) return { ok: true };
    const start = new Date(input.startTime);
    const location = await resolveBookingLocation(slug, staffId.data, start, input.locationId, {
      allowOffShift: false,
    });
    if (!location) return { ok: false, reason: "duration" };
    const guard = await checkBooking({
      slug,
      staffId: staffId.data,
      start,
      services: duration.services.map((svc) => ({
        serviceId: svc.serviceId,
        durationMinutes: svc.durationMinutes,
      })),
      totalMinutes: duration.totalMinutes,
      locationId: location.id,
      mode: "public",
      clientId: sessionClientId,
      serviceAddressId: input.serviceAddressId ?? null,
    });
    if (!guard.ok) return { ok: false, reason: "duration" };
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.name === "AuthError") throw err;
    return { ok: true };
  }
}

async function loadPublicBookingReceipt(slug: string, appointmentId: string) {
  return withTenantDb(slug, async (db, tables) => {
    const [row] = await db
      .select({
        id: tables.appointments.id,
        during: tables.appointments.during,
        locationName: tables.locations.name,
        locationAddress: tables.locations.address,
      })
      .from(tables.appointments)
      .leftJoin(tables.locations, eq(tables.appointments.locationId, tables.locations.id))
      .where(eq(tables.appointments.id, appointmentId))
      .limit(1);
    if (!row?.during) return null;
    const services = await getServicesForAppointment(
      db,
      { appointmentServices: tables.appointmentServices, services: tables.services },
      row.id,
    );
    return {
      id: row.id,
      start: row.during.start,
      end: row.during.end,
      locationName: row.locationName,
      locationAddress: row.locationAddress,
      services,
    };
  });
}

/**
 * Confirm a public booking. Guests never go through the staff booking action.
 * On success, loads the receipt for the confirmation page.
 */
export async function confirmBooking(data: {
  businessId: string;
  staffId: string;
  clientId: string;
  serviceIds: string[];
  startTime: string;
  locationId?: string | null;
  isDoubleBook?: boolean;
  doubleBookParentAppointmentId?: string | null;
  smsOptIn?: boolean;
  clientPhone?: string;
  /** On-site jobs: one of the client's saved addresses (see `saveClientAddressPublic`). */
  serviceAddressId?: string | null;
  /**
   * The client chose "Anyone available". `staffId` is the person the time step
   * assigned; if they were taken in the meantime, the slot is re-picked for the
   * same start.
   */
  anyStaff?: boolean;
  /** "YYYY-MM-DD". Asked for when a booked service has a minimum age and no birthday is on file. */
  dob?: string;
  /** Pay with one credit from the signed-in client's pack or membership (packages module). */
  useCredit?: boolean;
}) {
  const sessionClientId = await getBookingSession();
  if (!sessionClientId || sessionClientId !== data.clientId) {
    return { success: false as const, error: "Sign in to book" };
  }
  const slug = await getTenantSlug();
  let staffId = data.staffId;
  let isDoubleBook = data.isDoubleBook;
  let doubleBookParentAppointmentId = data.doubleBookParentAppointmentId;

  // Live external calendar conflict check before creating the booking
  const durationInfo = await getMultiServiceDuration(
    data.serviceIds,
    data.clientId,
    data.staffId,
  );

  // Public-boundary service eligibility: re-validate what the UI filtered so a
  // crafted request can't book internal-only or audience-restricted services.
  // (Staff booking goes through createBooking directly and is never restricted.)
  const [confirmClientRow] = await withTenantDb(slug, async (db, { clients }) =>
    db
      .select({ appointmentsBooked: clients.appointmentsBooked })
      .from(clients)
      .where(eq(clients.id, data.clientId))
      .limit(1),
  );
  const confirmClientIsNew = isNewClient(confirmClientRow?.appointmentsBooked);
  for (const svc of durationInfo.services) {
    if (svc.onlineBookable === 0) {
      return {
        success: false as const,
        error: (await getT("errors", slug))("bookingPublic.notOnlineBookable", { serviceName: svc.serviceName }),
      };
    }
    if (!canClientBookService(svc.bookingAudience, confirmClientIsNew)) {
      return {
        success: false as const,
        error: confirmClientIsNew
          ? `${svc.serviceName} is available to returning clients only. Please choose from the services shown.`
          : `${svc.serviceName} is only available to new clients.`,
      };
    }
  }

  // On-site services need a place to go. The wizard asks for it; this is the server's check.
  if (!data.serviceAddressId && (await needsAddress(slug, data.serviceIds))) {
    return {
      success: false as const,
      error: (await getT("errors", slug))("bookingPublic.addressRequired"),
    };
  }

  // Minimum age, checked before anything is written. Age is counted on the appointment's local day.
  const ageCheck = await enforceAgeGate(slug, {
    clientId: data.clientId,
    serviceIds: data.serviceIds,
    start: new Date(data.startTime),
    dobInput: data.dob,
    strict: true,
  });
  if (!ageCheck.ok) {
    const tc = await getT("consent", slug);
    return ageCheck.code === "UNDERAGE"
      ? { success: false as const, error: tc("underage", { minAge: ageCheck.minAge }) }
      : { success: false as const, error: tc("dobRequired"), code: "DOB_REQUIRED" as const };
  }

  const proposedStart = new Date(data.startTime);
  const proposedEnd = new Date(
    proposedStart.getTime() + durationInfo.totalMinutes * 60_000,
  );

  const JUST_TAKEN_ERROR = "This slot was just taken. Please select another time.";
  const isFlex = data.isDoubleBook === true;

  const externalCheck = isFlex
    ? { available: true }
    : await isExternalSlotAvailable(staffId, proposedStart, proposedEnd);

  const attempt = () =>
    bookAppointment({
      slug,
      staffId,
      clientId: data.clientId,
      serviceIds: data.serviceIds,
      start: proposedStart,
      locationId: data.locationId ?? null,
      mode: "public",
      flexParentId: isDoubleBook ? doubleBookParentAppointmentId ?? null : null,
      ...(data.serviceAddressId
        ? { extra: { serviceAddressId: data.serviceAddressId } }
        : {}),
    });
  const isJustTaken = (r: Awaited<ReturnType<typeof attempt>>) =>
    !r.ok &&
    (r.code === "SLOT_TAKEN" ||
      r.code === "RESOURCE_TAKEN" ||
      r.code === "BLOCKED" ||
      r.code === "TOO_SOON" ||
      (r.message ?? "").includes("conflicts"));

  if (!externalCheck.available && !data.anyStaff) {
    return { success: false as const, error: JUST_TAKEN_ERROR };
  }

  let result = externalCheck.available
    ? await attempt()
    : ({ ok: false as const, code: "SLOT_TAKEN" as const, message: "conflicts" });

  // "Anyone available": the assigned person was taken. Find someone else free at
  // exactly this start and try once more.
  if (data.anyStaff && !result.ok && isJustTaken(result)) {
    const tz = (await loadSchedulingSettings(slug)).timezone;
    const slots = await listDaySlots({
      slug,
      staffId: "any",
      locationId: data.locationId ?? null,
      serviceIds: data.serviceIds,
      clientId: data.clientId,
      serviceAddressId: data.serviceAddressId ?? null,
      day: localDay(proposedStart, tz),
    });
    const replacement = slots.find(
      (s) => s.start.getTime() === proposedStart.getTime() && s.staffId !== staffId,
    );
    if (replacement) {
      const candidate = await isExternalSlotAvailable(replacement.staffId, proposedStart, proposedEnd);
      if (candidate.available || replacement.isFlex) {
        staffId = replacement.staffId;
        isDoubleBook = replacement.isFlex;
        doubleBookParentAppointmentId = replacement.hostAppointmentId ?? null;
        result = await attempt();
      }
    }
  }

  if (!result.ok) {
    if (isJustTaken(result)) {
      return { success: false as const, error: JUST_TAKEN_ERROR };
    }
    return {
      success: false as const,
      error: result.message ?? (await failureMessage(result.code, slug)),
    };
  }

  await withTenantDb(slug, async (db, { clients }) => {
    await db
      .update(clients)
      .set({ appointmentsBooked: sql`${clients.appointmentsBooked} + 1` })
      .where(eq(clients.id, data.clientId));
  });
  await syncAutoAssistantTasksForAppointment(slug, result.id);

  // Push booking to external calendar (fire-and-forget -- booking already succeeded)
  // Pass slug explicitly since this may run outside request context
  pushBookingToCalendarForTenant(slug, result.id).catch((err) => {
    console.error("Calendar push failed for appointment:", result.id, err);
  });

  // Credit: when the client chose to use one, spend it now. No package that fits means the
  // booking stands and the normal deposit flow below runs.
  const creditApplied = data.useCredit === true ? await applyBookingCredit(slug, data.clientId, data.serviceIds, result.id) : false;

  // Deposit: record the resolved deposit on the appointment and collect it now
  // if the client already has a card. If not, the deposit_cents is stored and the
  // payment step collects it once a card is saved. A credit-paid booking has no deposit.
  let depositInfo: { cents: number; charged: boolean } | null = null;
  if (!creditApplied) {
    try {
      const {
        previewBookingDepositForTenant,
        chargeBookingDepositForTenant,
      } = await import("@/lib/services/booking-deposits");
      const preview = await previewBookingDepositForTenant(
        slug,
        data.serviceIds,
        data.clientId,
        staffId,
      );
      if (preview.enabled && preview.totalCents > 0) {
        await withTenantDb(slug, async (db, { appointments }) => {
          await db
            .update(appointments)
            .set({ depositCents: preview.totalCents, updatedAt: new Date() })
            .where(eq(appointments.id, result.id));
        });
        const outcome = await chargeBookingDepositForTenant(slug, result.id);
        depositInfo = { cents: preview.totalCents, charged: outcome.charged };
      }
    } catch (err) {
      console.error("Deposit handling failed for appointment:", result.id, err);
    }
  }

  // Record SMS consent if client opted in (fire-and-forget -- don't block booking)
  if (data.smsOptIn && data.clientPhone) {
    import("@/lib/sms/consent")
      .then(({ recordSmsConsent }) =>
        recordSmsConsent(
          slug,
          data.clientId,
          data.clientPhone!,
          "booking_form",
          "booking_page",
        ),
      )
      .catch((err) => {
        console.error("SMS consent recording failed for client:", data.clientId, err);
      });
  }

  const appointment = await loadPublicBookingReceipt(slug, result.id);
  if (!appointment) {
    return { success: true as const, booking: { id: result.id }, creditApplied };
  }

  const totalDuration = appointment.services.reduce(
    (sum, s) => sum + s.durationMinutes,
    0,
  );

  // Look up staff display name
  const staffDisplayName = await withTenantDb(slug, async (db, { staff }) => {
    const [staffMember] = await db
      .select({ displayName: staff.displayName })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);
    return staffMember?.displayName ?? null;
  });
  const staffName =
    staffDisplayName ??
    (await getT("booking", slug))("bookingWizard.staffFallback");

  void sendBookingConfirmations(slug, result.id);

  trackEvent("booking.created", { source: "public", serviceCount: data.serviceIds.length }, { tenantSlug: slug });

  return {
    success: true as const,
    creditApplied,
    booking: {
      id: appointment.id,
      staffName,
      services: appointment.services.map((s) => ({
        name: s.serviceName,
        durationMinutes: s.durationMinutes,
      })),
      start: appointment.start.toISOString(),
      end: appointment.end.toISOString(),
      totalDuration,
      locationName: appointment.locationName ?? null,
      locationAddress: appointment.locationAddress ?? null,
      depositCents: depositInfo?.cents ?? 0,
      depositCharged: depositInfo?.charged ?? false,
    },
  };
}

/**
 * Update a client's name.
 * Used when a new client enters their name after OTP verification.
 */
export async function updateClientName(clientId: string, name: string) {
  const sessionClientId = await getBookingSession();
  if (!sessionClientId || sessionClientId !== clientId) {
    return { success: false as const, error: "Unauthorized" };
  }
  try {
    const slug = await getTenantSlug();
    await withTenantDb(slug, async (db, { clients }) => {
      await db
        .update(clients)
        .set({ name, updatedAt: new Date() })
        .where(eq(clients.id, clientId));
    });

    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: "Failed to update client name",
    };
  }
}
