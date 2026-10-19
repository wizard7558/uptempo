"use server";

import { headers } from "next/headers";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenantDb } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { hasModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { normalizePhone } from "@/lib/phone";
import { clientIpFrom } from "@/lib/http/client-ip";
import { hashPublicToken, isPublicTokenShape } from "@/lib/security/public-token";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { daysBetween, localDay } from "@/lib/scheduling/intervals";
import { timeOfDayRange, type TimeOfDay } from "@/lib/waitlist/match";
import { formatBusinessDay, formatBusinessTime } from "@/lib/waitlist/clock";
import { declineOffer, markOfferBooked, processOpening } from "@/lib/waitlist/opening";
import { bookAppointment } from "@/lib/booking/book";
import { sendBookingConfirmations } from "@/lib/booking/confirmations";
import { enforceAgeGate } from "@/lib/consent/gate";
import { syncAutoAssistantTasksForAppointment } from "@/lib/services/sync-auto-assistant-tasks";
import { trackEvent } from "@/lib/analytics/events";
import { recordSmsConsent } from "@/lib/sms/consent";

const HOUR_MS = 3_600_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const joinSchema = z.object({
  serviceIds: z.array(z.string().uuid()).min(1).max(5),
  staffId: z.union([z.string().uuid(), z.literal("any")]),
  locationId: z.string().uuid().nullable(),
  dateFrom: z.string().regex(DAY),
  dateTo: z.string().regex(DAY),
  timeOfDay: z.enum(["any", "morning", "afternoon", "evening"]),
  phone: z.string().optional(),
  smsConsent: z.boolean(),
  website: z.string().optional(),
});

export type JoinSlotWaitlistInput = z.input<typeof joinSchema>;

export type JoinResult = { success: true } | { success: false; error: string };

export type ClaimStatus = "booked" | "taken" | "expired" | "notFound" | "declined" | "removed";

export type ClaimOffer =
  | { state: "notFound" | "expired" | "booked" | "removed" }
  | {
      state: "valid";
      service: string;
      staff: string;
      date: string;
      time: string;
      heldUntil: string;
    };

async function fail(slug: string, key: string): Promise<JoinResult> {
  return { success: false, error: (await getT("errors", slug))(`waitlist.${key}`) };
}

export async function joinSlotWaitlist(input: JoinSlotWaitlistInput): Promise<JoinResult> {
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, "slot_waitlist"))) {
    const [te, tm] = await Promise.all([getT("errors", slug), getT("modules", slug)]);
    return { success: false, error: te("modules.turnedOff", { name: tm("items.slot_waitlist.name") }) };
  }

  const clientId = await getBookingSession();
  if (!clientId) return fail(slug, "needsSession");
  if (input.website && input.website.trim() !== "") return fail(slug, "rateLimited");

  const ip = clientIpFrom(await headers());
  const limited = await consumeRateLimit({
    tenantSlug: slug,
    scope: "ip",
    key: `waitlist_join:${ip}`,
    limit: 10,
    windowMs: HOUR_MS,
  });
  if (!limited.allowed) return fail(slug, "rateLimited");

  const parsed = joinSchema.safeParse(input);
  if (!parsed.success) return fail(slug, "badDates");
  const data = parsed.data;

  const tz = await withTenantDb(slug, async (db, { businessSettings }) => {
    const [row] = await db
      .select({ timezone: businessSettings.timezone })
      .from(businessSettings)
      .limit(1);
    return row?.timezone ?? "America/New_York";
  });

  let span = 0;
  try {
    span = daysBetween(data.dateFrom, data.dateTo);
  } catch {
    return fail(slug, "badDates");
  }
  const today = localDay(new Date(), tz);
  if (data.dateFrom < today || span < 0 || span > 60) return fail(slug, "badDates");

  const active = await withTenantDb(slug, async (db, { slotWaitlist }) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(slotWaitlist)
      .where(
        and(
          eq(slotWaitlist.clientId, clientId),
          inArray(slotWaitlist.status, ["waiting", "offered"]),
        ),
      );
    return row?.n ?? 0;
  });
  if (active >= 5) return fail(slug, "tooMany");

  const client = await withTenantDb(slug, async (db, { clients }) => {
    const [row] = await db
      .select({ phone: clients.phone })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    return row ?? null;
  });
  if (!client) return fail(slug, "needsSession");

  let phone = client.phone ? normalizePhone(client.phone) : null;
  if (!phone) {
    phone = normalizePhone(data.phone);
    if (!phone) return fail(slug, "invalidPhone");
    const savedPhone = phone;
    try {
      await withTenantDb(slug, async (db, { clients }) => {
        await db.update(clients).set({ phone: savedPhone }).where(eq(clients.id, clientId));
      });
    } catch (err) {
      if (pgErrorInfo(err).code === "23505") return fail(slug, "invalidPhone");
      throw err;
    }
  }

  if (!data.smsConsent) return fail(slug, "needsConsent");
  await recordSmsConsent(slug, clientId, phone, "waitlist_form", ip);

  const window = timeOfDayRange(data.timeOfDay as TimeOfDay);
  await withTenantDb(slug, async (db, { slotWaitlist }) => {
    await db.insert(slotWaitlist).values({
      clientId,
      serviceIds: data.serviceIds,
      staffId: data.staffId === "any" ? null : data.staffId,
      locationId: data.locationId,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      timeFrom: window.from,
      timeTo: window.to,
      source: "online",
    });
  });
  return { success: true };
}

async function findByToken(slug: string, token: string) {
  if (!isPublicTokenShape(token)) return null;
  const hash = hashPublicToken(token);
  return withTenantDb(slug, async (db, { slotWaitlist }) => {
    const [row] = await db
      .select()
      .from(slotWaitlist)
      .where(eq(slotWaitlist.offerTokenHash, hash))
      .limit(1);
    return row ?? null;
  });
}

export async function loadWaitlistClaim(token: string): Promise<ClaimOffer> {
  const slug = await getTenantSlug();
  const row = await findByToken(slug, token);
  if (!row) return { state: "notFound" };
  if (row.status === "booked") return { state: "booked" };
  if (row.status === "cancelled") return { state: "removed" };
  const held =
    row.status === "offered" &&
    row.offerExpiresAt != null &&
    row.offerExpiresAt.getTime() > Date.now() &&
    row.offeredStart != null &&
    row.offeredStaffId != null;
  if (!held || !row.offeredStart || !row.offeredStaffId) return { state: "expired" };

  const names = await withTenantDb(slug, async (db, t) => {
    const [settings] = await db
      .select({ timezone: t.businessSettings.timezone })
      .from(t.businessSettings)
      .limit(1);
    const services = row.serviceIds.length
      ? await db
          .select({ id: t.services.id, name: t.services.name })
          .from(t.services)
          .where(inArray(t.services.id, row.serviceIds))
      : [];
    const [staff] = await db
      .select({ name: t.staff.displayName })
      .from(t.staff)
      .where(eq(t.staff.id, row.offeredStaffId!))
      .limit(1);
    return {
      timezone: settings?.timezone ?? "America/New_York",
      service: services.map((s) => s.name).join(", ") || "Visit",
      staff: staff?.name ?? "Staff",
    };
  });

  const start = row.offeredStart;
  return {
    state: "valid",
    service: names.service,
    staff: names.staff,
    date: formatBusinessDay(start, names.timezone),
    time: formatBusinessTime(start, names.timezone),
    heldUntil: row.offerExpiresAt ? formatBusinessTime(row.offerExpiresAt, names.timezone) : "",
  };
}

export async function claimWaitlistOffer(token: string): Promise<{ status: ClaimStatus }> {
  const slug = await getTenantSlug();
  const row = await findByToken(slug, token);
  if (!row) return { status: "notFound" };
  const live =
    row.status === "offered" &&
    row.offerExpiresAt != null &&
    row.offerExpiresAt.getTime() > Date.now() &&
    row.offeredStaffId != null &&
    row.offeredStart != null;
  if (!live || !row.offeredStaffId || !row.offeredStart) return { status: "expired" };

  const ageCheck = await enforceAgeGate(slug, {
    clientId: row.clientId,
    serviceIds: row.serviceIds,
    start: row.offeredStart,
    strict: false,
  });
  if (!ageCheck.ok) {
    await declineOffer(slug, token);
    return { status: "taken" };
  }

  const booked = await bookAppointment({
    slug,
    staffId: row.offeredStaffId,
    clientId: row.clientId,
    serviceIds: row.serviceIds,
    start: row.offeredStart,
    locationId: row.offeredLocationId,
    mode: "public",
    ignoreHoldIds: [row.id],
  });
  if (!booked.ok) {
    await declineOffer(slug, token);
    return { status: "taken" };
  }

  await withTenantDb(slug, async (db, { clients }) => {
    await db
      .update(clients)
      .set({ appointmentsBooked: sql`${clients.appointmentsBooked} + 1` })
      .where(eq(clients.id, row.clientId));
  });
  await syncAutoAssistantTasksForAppointment(slug, booked.id);
  void sendBookingConfirmations(slug, booked.id);
  trackEvent(
    "booking.created",
    { source: "waitlist", serviceCount: row.serviceIds.length },
    { tenantSlug: slug },
  );
  await markOfferBooked(slug, row.id, booked.id);
  return { status: "booked" };
}

export async function declineWaitlistOffer(token: string): Promise<{ status: ClaimStatus }> {
  const slug = await getTenantSlug();
  const row = await findByToken(slug, token);
  if (!row || row.status !== "offered") return { status: "notFound" };
  await declineOffer(slug, token);
  return { status: "declined" };
}

export async function leaveSlotWaitlist(token: string): Promise<{ status: ClaimStatus }> {
  const slug = await getTenantSlug();
  const row = await findByToken(slug, token);
  if (!row || row.status === "booked" || row.status === "cancelled") return { status: "notFound" };
  const openingId = row.status === "offered" ? row.openingId : null;
  await withTenantDb(slug, async (db, { slotWaitlist }) => {
    await db
      .update(slotWaitlist)
      .set({
        status: "cancelled",
        openingId: null,
        offerTokenHash: null,
        offerExpiresAt: null,
        offeredStaffId: null,
        offeredStart: null,
        offeredEnd: null,
        offeredLocationId: null,
        updatedAt: new Date(),
      })
      .where(eq(slotWaitlist.id, row.id));
  });
  if (openingId) {
    await withTenantDb(slug, async (db, { waitlistOpenings }) => {
      await db
        .update(waitlistOpenings)
        .set({ status: "open", updatedAt: new Date() })
        .where(and(eq(waitlistOpenings.id, openingId), eq(waitlistOpenings.status, "offered")));
    });
    await processOpening(slug, openingId);
  }
  return { status: "removed" };
}
