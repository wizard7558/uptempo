"use server";

import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { z } from "zod";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { setBookingSession } from "@/lib/booking/session-cookie";
import { bookAppointment } from "@/lib/booking/book";
import { enforceAgeGate, getAgeGate } from "@/lib/consent/gate";
import { failureMessage } from "@/lib/booking/failure-message";
import { sendBookingConfirmations } from "@/lib/booking/confirmations";
import { listBookableDays, listDaySlots } from "@/lib/scheduling/service";
import { loadSchedulingSettings, loadStaffNames } from "@/lib/scheduling/load";
import { expireStaleQuotes } from "@/lib/requests/expire";
import { trackEvent } from "@/lib/analytics/events";
import { syncAutoAssistantTasksForAppointment } from "@/lib/services/sync-auto-assistant-tasks";
import { pushBookingToCalendarForTenant } from "@/lib/calendar/sync-tenant";
import { chargeBookingDepositForTenant } from "@/lib/services/booking-deposits";
import { clientIpFrom } from "@/lib/http/client-ip";

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type QuotePageState =
  | "open"
  | "expired"
  | "accepted"
  | "declined"
  | "withdrawn"
  | "unavailable";

export type QuotePageLine = { description: string; quantity: number; unitCents: number };

export type QuotePageData = {
  state: QuotePageState;
  businessName: string;
  clientFirstName: string;
  quote: {
    subtotalCents: number;
    depositCents: number;
    message: string | null;
    validUntilLabel: string | null;
    staffId: string | null;
  } | null;
  lines: QuotePageLine[];
  booked?: { dateLabel: string; timeLabel: string; staffName: string | null };
  /** Set when the quoted work has a minimum age and no birthday is on file: the page asks for one. */
  ageGate?: { minAge: number } | null;
};

export type QuoteSlot = {
  /** ISO start time. */
  time: string;
  /** "10:00 AM" in the business's time zone. */
  label: string;
  part: "morning" | "afternoon" | "evening";
  staffId: string;
  staffName: string | null;
  /** On-site jobs: the arrival window, e.g. "9:00 AM" to "11:00 AM". */
  arrival?: { startLabel: string; endLabel: string };
};

type OpenQuote = {
  slug: string;
  quoteId: string;
  requestId: string;
  clientId: string;
  /** The client's address for an on-site job (from the request), or null. */
  addressId: string | null;
  staffId: string | null;
  depositCents: number;
  subtotalCents: number;
  /** Set: accepting creates a project with this many sessions. */
  projectSessions: number | null;
  validUntil: Date;
  lines: { serviceId: string; description: string; quantity: number; unitCents: number; minutes: number }[];
};

const unavailable = (businessName = ""): QuotePageData => ({
  state: "unavailable",
  businessName,
  clientFirstName: "",
  quote: null,
  lines: [],
});

async function businessNameOf(slug: string): Promise<string> {
  return (await getTenantBySlug(slug))?.name ?? "";
}

/** The sent, unexpired quote behind a link, with its lines; null when the link isn't open. */
async function loadOpenQuote(slug: string, token: string): Promise<OpenQuote | null> {
  if (!TOKEN_RE.test(token)) return null;
  if (!(await hasModule(slug, "requests"))) return null;
  return withTenantDb(slug, async (db, t) => {
    await expireStaleQuotes(db, t);
    const [row] = await db
      .select({
        quoteId: t.quotes.id,
        requestId: t.quotes.requestId,
        clientId: t.bookingRequests.clientId,
        addressId: t.bookingRequests.addressId,
        staffId: t.quotes.staffId,
        depositCents: t.quotes.depositCents,
        subtotalCents: t.quotes.subtotalCents,
        projectSessions: t.quotes.projectSessions,
        validUntil: t.quotes.validUntil,
        status: t.quotes.status,
      })
      .from(t.quotes)
      .innerJoin(t.bookingRequests, eq(t.bookingRequests.id, t.quotes.requestId))
      .where(eq(t.quotes.accessToken, token))
      .limit(1);
    if (!row || row.status !== "sent" || !row.validUntil || row.validUntil.getTime() <= Date.now()) {
      return null;
    }
    const lines = await db
      .select({
        serviceId: t.quoteLineItems.serviceId,
        description: t.quoteLineItems.description,
        quantity: t.quoteLineItems.quantity,
        unitCents: t.quoteLineItems.unitCents,
        minutes: t.quoteLineItems.minutes,
      })
      .from(t.quoteLineItems)
      .where(eq(t.quoteLineItems.quoteId, row.quoteId))
      .orderBy(asc(t.quoteLineItems.sort));
    if (lines.length === 0) return null;
    return { slug, ...row, validUntil: row.validUntil, lines };
  });
}

function slotQuery(q: OpenQuote) {
  return {
    slug: q.slug,
    staffId: q.staffId ?? ("any" as const),
    locationId: null,
    serviceIds: [...new Set(q.lines.map((l) => l.serviceId))],
    clientId: q.clientId,
    lineDurations: q.lines.map((l) => ({ serviceId: l.serviceId, durationMinutes: l.minutes })),
    serviceAddressId: q.addressId,
  };
}

/** Everything the public quote page shows. Never throws for a bad link; it says "unavailable". */
export async function getQuoteForPage(token: string): Promise<QuotePageData> {
  const slug = await getTenantSlug();
  const businessName = await businessNameOf(slug);
  if (!TOKEN_RE.test(token) || !(await hasModule(slug, "requests"))) {
    return unavailable(businessName);
  }
  const tz = (await loadSchedulingSettings(slug)).timezone;

  return withTenantDb(slug, async (db, t): Promise<QuotePageData> => {
    await expireStaleQuotes(db, t);
    const [row] = await db
      .select({
        quoteId: t.quotes.id,
        status: t.quotes.status,
        staffId: t.quotes.staffId,
        subtotalCents: t.quotes.subtotalCents,
        depositCents: t.quotes.depositCents,
        message: t.quotes.message,
        validUntil: t.quotes.validUntil,
        appointmentId: t.quotes.appointmentId,
        clientName: t.clients.name,
        clientBirthday: t.clients.birthday,
      })
      .from(t.quotes)
      .innerJoin(t.bookingRequests, eq(t.bookingRequests.id, t.quotes.requestId))
      .innerJoin(t.clients, eq(t.clients.id, t.bookingRequests.clientId))
      .where(eq(t.quotes.accessToken, token))
      .limit(1);
    if (!row || row.status === "draft") return unavailable(businessName);

    const lineRows = await db
      .select({
        serviceId: t.quoteLineItems.serviceId,
        description: t.quoteLineItems.description,
        quantity: t.quoteLineItems.quantity,
        unitCents: t.quoteLineItems.unitCents,
      })
      .from(t.quoteLineItems)
      .where(eq(t.quoteLineItems.quoteId, row.quoteId))
      .orderBy(asc(t.quoteLineItems.sort));
    const ageGate =
      row.status === "sent" && !row.clientBirthday
        ? await getAgeGate(slug, [...new Set(lineRows.map((l) => l.serviceId))])
        : null;
    const lines = lineRows.map(({ description, quantity, unitCents }) => ({ description, quantity, unitCents }));

    const state = row.status as Exclude<QuotePageState, "open" | "unavailable"> | "sent";
    let booked: QuotePageData["booked"];
    if (state === "accepted" && row.appointmentId) {
      const [appt] = await db
        .select({ during: t.appointments.during, staffId: t.appointments.staffId })
        .from(t.appointments)
        .where(eq(t.appointments.id, row.appointmentId))
        .limit(1);
      if (appt) {
        const names = await loadStaffNames(slug, [appt.staffId]);
        const start = new TZDate(appt.during.start, tz);
        booked = {
          dateLabel: format(start, "EEEE, MMMM d, yyyy"),
          timeLabel: format(start, "h:mm a"),
          staffName: names[appt.staffId] ?? null,
        };
      }
    }
    return {
      state: state === "sent" ? "open" : state,
      businessName,
      clientFirstName: (row.clientName ?? "").trim().split(/\s+/)[0] ?? "",
      quote: {
        subtotalCents: row.subtotalCents,
        depositCents: row.depositCents,
        message: row.message,
        validUntilLabel: row.validUntil ? format(new TZDate(row.validUntil, tz), "MMMM d, yyyy") : null,
        staffId: row.staffId,
      },
      lines,
      booked,
      ageGate: ageGate ? { minAge: ageGate.minAge } : null,
    };
  });
}

/** Local days (YYYY-MM-DD) with at least one open time for this quote. */
export async function getQuoteDays(token: string): Promise<string[]> {
  const slug = await getTenantSlug();
  const quote = await loadOpenQuote(slug, token);
  if (!quote) return [];
  return listBookableDays(slotQuery(quote));
}

/** Open start times for one local day, with the person each one would be with. */
export async function getQuoteSlots(token: string, day: string): Promise<QuoteSlot[]> {
  if (!DAY_RE.test(day)) return [];
  const slug = await getTenantSlug();
  const quote = await loadOpenQuote(slug, token);
  if (!quote) return [];
  const [slots, settings] = await Promise.all([
    listDaySlots({ ...slotQuery(quote), day }),
    loadSchedulingSettings(slug),
  ]);
  // A quote books a whole job, so it never goes into someone else's processing window.
  const own = slots.filter((s) => !s.isFlex);
  const names = await loadStaffNames(slug, own.map((s) => s.staffId));
  return own.map((s) => {
    const local = new TZDate(s.start, settings.timezone);
    const hour = local.getHours();
    return {
      time: s.start.toISOString(),
      label: format(local, "h:mm a"),
      part: hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening",
      staffId: s.staffId,
      staffName: names[s.staffId] ?? null,
      ...(s.arrivalWindow
        ? {
            arrival: {
              startLabel: format(new TZDate(s.arrivalWindow.start, settings.timezone), "h:mm a"),
              endLabel: format(new TZDate(s.arrivalWindow.end, settings.timezone), "h:mm a"),
            },
          }
        : {}),
    };
  });
}

const acceptSchema = z.object({
  token: z.string().regex(TOKEN_RE),
  start: z.string().datetime({ offset: true }),
  staffId: z.string().uuid(),
  acceptedName: z.string().trim().min(2).max(120),
  agree: z.literal(true),
  dob: z.string().max(10).optional(),
});

export type AcceptQuoteResult =
  | { success: false; error: string; code?: "DOB_REQUIRED" }
  | {
      success: true;
      appointmentId: string;
      depositCents: number;
      needsCard: boolean;
      depositPaid: boolean;
      booked: { dateLabel: string; timeLabel: string; staffName: string | null };
    };

/**
 * Turns an open quote into a booked job. The request row is claimed with one
 * atomic UPDATE so two taps (or two devices) can't both book. A crashed claim
 * heals itself after 10 minutes. The deposit goes through the same card path as
 * the classic booking flow.
 */
export async function acceptQuote(input: {
  token: string;
  start: string;
  staffId: string;
  acceptedName: string;
  agree: boolean;
  /** "YYYY-MM-DD", for work with a minimum age when no birthday is on file. */
  dob?: string;
}): Promise<AcceptQuoteResult> {
  const slug = await getTenantSlug();
  const te = await getT("errors", slug);
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: te("requests.acceptInvalid") };
  const { token, staffId, acceptedName } = parsed.data;
  const start = new Date(parsed.data.start);

  const quote = await loadOpenQuote(slug, token);
  if (!quote) return { success: false, error: te("requests.quoteClosed") };
  if (quote.staffId && quote.staffId !== staffId) {
    return { success: false, error: te("requests.staffMismatch") };
  }

  // Minimum age, checked before the request is claimed or anything is booked.
  const ageCheck = await enforceAgeGate(slug, {
    clientId: quote.clientId,
    serviceIds: [...new Set(quote.lines.map((l) => l.serviceId))],
    start,
    dobInput: parsed.data.dob,
    strict: true,
  });
  if (!ageCheck.ok) {
    const tc = await getT("consent", slug);
    return ageCheck.code === "UNDERAGE"
      ? { success: false, error: tc("underage", { minAge: ageCheck.minAge }) }
      : { success: false, error: tc("dobRequired"), code: "DOB_REQUIRED" };
  }

  // Claim. No row means someone else holds it (or the request moved on).
  const claimed = await withTenantDb(slug, async (db, t) =>
    db
      .update(t.bookingRequests)
      .set({ status: "accepted", updatedAt: sql`now()` })
      .where(
        and(
          eq(t.bookingRequests.id, quote.requestId),
          or(
            eq(t.bookingRequests.status, "quoted"),
            // A claim older than 10 minutes is a crashed attempt and can be taken again.
            and(
              eq(t.bookingRequests.status, "accepted"),
              lt(t.bookingRequests.updatedAt, sql`now() - interval '10 minutes'`),
            ),
          ),
        ),
      )
      .returning({ id: t.bookingRequests.id }),
  );
  if (claimed.length === 0) return { success: false, error: te("requests.alreadyAccepting") };

  const release = () =>
    withTenantDb(slug, async (db, t) =>
      db
        .update(t.bookingRequests)
        .set({ status: "quoted", updatedAt: sql`now()` })
        .where(and(eq(t.bookingRequests.id, quote.requestId), eq(t.bookingRequests.status, "accepted"))),
    );

  const arrivalWindowMin = quote.addressId ? (await loadSchedulingSettings(slug)).arrivalWindowMin : null;

  let booking: Awaited<ReturnType<typeof bookAppointment>>;
  try {
    booking = await bookAppointment({
      slug,
      staffId,
      clientId: quote.clientId,
      serviceIds: [...new Set(quote.lines.map((l) => l.serviceId))],
      start,
      locationId: null,
      mode: "public",
      lineOverrides: quote.lines.map((l) => ({
        serviceId: l.serviceId,
        durationMinutes: l.minutes,
        priceCents: l.quantity * l.unitCents,
        notes: l.description,
      })),
      extra: {
        depositCents: quote.depositCents,
        ...(quote.addressId
          ? { serviceAddressId: quote.addressId, arrivalWindowMin: arrivalWindowMin }
          : {}),
      },
    });
  } catch (err) {
    await release();
    throw err;
  }

  if (!booking.ok) {
    await release();
    const retryable = ["SLOT_TAKEN", "RESOURCE_TAKEN", "BLOCKED", "TOO_SOON"].includes(booking.code);
    return {
      success: false,
      error: retryable ? te("requests.slotTaken") : await failureMessage(booking.code, slug),
    };
  }
  const appointmentId = booking.id;

  const projectsOn = quote.projectSessions != null && (await hasModule(slug, "projects"));
  const callerIp = clientIpFrom(await headers());
  const ip = callerIp === "unknown" ? null : callerIp;
  await withTenantDb(slug, async (db, t) =>
    db.transaction(async (tx) => {
      await tx
        .update(t.quotes)
        .set({
          status: "accepted",
          acceptedAt: sql`now()`,
          acceptedName,
          acceptedIp: ip,
          appointmentId,
          updatedAt: sql`now()`,
        })
        .where(eq(t.quotes.id, quote.quoteId));
      await tx
        .update(t.bookingRequests)
        .set({ status: "converted", appointmentId, updatedAt: sql`now()` })
        .where(eq(t.bookingRequests.id, quote.requestId));
      // A multi-session quote becomes a project, and its first appointment joins it.
      if (quote.projectSessions != null && projectsOn) {
        const [project] = await tx
          .insert(t.projects)
          .values({
            clientId: quote.clientId,
            staffId,
            requestId: quote.requestId,
            title: (quote.lines[0]?.description ?? "").trim().slice(0, 120) || "Project",
            status: "scheduled",
            estSessions: quote.projectSessions,
            quotedTotalCents: quote.subtotalCents,
            accessToken: randomBytes(24).toString("base64url"),
          })
          .returning({ id: t.projects.id });
        await tx.update(t.appointments).set({ projectId: project.id }).where(eq(t.appointments.id, appointmentId));
      }
    }),
  );

  pushBookingToCalendarForTenant(slug, appointmentId).catch((err) => {
    console.error("Calendar push failed for appointment:", appointmentId, err);
  });
  await withTenantDb(slug, async (db, { clients }) =>
    db
      .update(clients)
      .set({ appointmentsBooked: sql`${clients.appointmentsBooked} + 1` })
      .where(eq(clients.id, quote.clientId)),
  );
  try {
    await syncAutoAssistantTasksForAppointment(slug, appointmentId);
  } catch (err) {
    console.error("Assistant task sync failed for appointment:", appointmentId, err);
  }
  void sendBookingConfirmations(slug, appointmentId);
  trackEvent("booking.created", { source: "quote", serviceCount: quote.lines.length }, { tenantSlug: slug });

  const tz = (await loadSchedulingSettings(slug)).timezone;
  const names = await loadStaffNames(slug, [staffId]);
  const local = new TZDate(start, tz);
  const booked = {
    dateLabel: format(local, "EEEE, MMMM d, yyyy"),
    timeLabel: format(local, "h:mm a"),
    staffName: names[staffId] ?? null,
  };

  let needsCard = false;
  let depositPaid = false;
  if (quote.depositCents > 0) {
    try {
      const outcome = await chargeBookingDepositForTenant(slug, appointmentId);
      if (outcome.reason === "no_card") {
        needsCard = true;
        await setBookingSession(quote.clientId);
      } else {
        depositPaid = outcome.charged;
      }
    } catch (err) {
      console.error("Quote deposit failed for appointment:", appointmentId, err);
    }
  }
  return {
    success: true,
    appointmentId,
    depositCents: quote.depositCents,
    needsCard,
    depositPaid,
    booked,
  };
}

/** "No thanks": the quote is declined and the request closes. */
export async function declineQuote(token: string): Promise<{ success: boolean }> {
  const slug = await getTenantSlug();
  const quote = await loadOpenQuote(slug, token);
  if (!quote) return { success: false };
  const changed = await withTenantDb(slug, async (db, t) =>
    db.transaction(async (tx) => {
      const q = await tx
        .update(t.quotes)
        .set({ status: "declined", declinedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(t.quotes.id, quote.quoteId), eq(t.quotes.status, "sent")))
        .returning({ id: t.quotes.id });
      if (q.length === 0) return false;
      const r = await tx
        .update(t.bookingRequests)
        .set({ status: "declined", updatedAt: sql`now()` })
        .where(and(eq(t.bookingRequests.id, quote.requestId), inArray(t.bookingRequests.status, ["quoted"])))
        .returning({ id: t.bookingRequests.id });
      if (r.length === 0) throw new Error("request moved on");
      return true;
    }),
  ).catch(() => false);
  return { success: changed };
}
