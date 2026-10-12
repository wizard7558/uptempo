import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { and, asc, eq, inArray, lt, lte, gte, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { checkBooking } from "@/lib/scheduling/service";
import { localDay } from "@/lib/scheduling/intervals";
import { getMultiServiceDuration } from "@/lib/services/duration";
import { sendSms } from "@/lib/sms/send";
import { DEFAULT_SMS_WAITLIST_OFFER_TEMPLATE, renderSmsTemplate } from "@/lib/sms/template";
import { isWithinSendWindow } from "@/lib/sms/quiet-hours";
import { hashPublicToken, newPublicToken } from "@/lib/security/public-token";
import { getBaseUrl } from "@/lib/utils";
import { entryFits } from "./match";

const MIN = 60_000;
const OFFER_LEAD_MS = 30 * MIN;
const MAX_SMS_FAILURES = 3;

type Settings = { timezone: string; holdMinutes: number };

async function loadSettings(slug: string): Promise<Settings> {
  const [row] = await withTenantDb(slug, async (db, { businessSettings }) =>
    db
      .select({
        timezone: businessSettings.timezone,
        holdMinutes: businessSettings.waitlistHoldMinutes,
      })
      .from(businessSettings)
      .limit(1),
  );
  return {
    timezone: row?.timezone ?? "America/New_York",
    holdMinutes: row?.holdMinutes ?? 15,
  };
}

function clock(at: Date, tz: string): string {
  return format(new TZDate(at, tz), "HH:mm");
}

export async function recordOpeningForCancelledAppointment(
  slug: string,
  appointmentId: string,
  now = new Date(),
): Promise<void> {
  if (!(await hasModule(slug, "slot_waitlist"))) return;

  const appt = await withTenantDb(slug, async (db, { appointments }) => {
    const [row] = await db
      .select({
        id: appointments.id,
        staffId: appointments.staffId,
        locationId: appointments.locationId,
        during: appointments.during,
        status: appointments.status,
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    return row ?? null;
  });
  if (!appt || appt.status !== "cancelled") return;
  if (appt.during.start.getTime() < now.getTime() + OFFER_LEAD_MS) return;
  if (appt.during.end.getTime() <= appt.during.start.getTime()) return;

  const inserted = await withTenantDb(slug, async (db, { waitlistOpenings }) =>
    db
      .insert(waitlistOpenings)
      .values({
        appointmentId: appt.id,
        staffId: appt.staffId,
        locationId: appt.locationId,
        startsAt: appt.during.start,
        endsAt: appt.during.end,
      })
      .onConflictDoNothing({
        target: waitlistOpenings.appointmentId,
        where: sql`${waitlistOpenings.appointmentId} IS NOT NULL`,
      })
      .returning({ id: waitlistOpenings.id }),
  );
  if (inserted.length === 0) return;
  await processOpening(slug, inserted[0].id, now);
}

/**
 * Offers an open opening to the first matching waitlist entry.
 * A row lock keeps two workers from texting the same opening.
 */
export async function processOpening(slug: string, openingId: string, now = new Date()): Promise<void> {
  const settings = await loadSettings(slug);
  if (!isWithinSendWindow(settings.timezone, now)) return;

  await withTenantDb(slug, async (db, t) =>
    db.transaction(async (tx) => {
      const [opening] = await tx
        .select()
        .from(t.waitlistOpenings)
        .where(eq(t.waitlistOpenings.id, openingId))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!opening || opening.status !== "open") return;

      if (opening.startsAt.getTime() < now.getTime() + OFFER_LEAD_MS || opening.attempts >= 3) {
        await tx
          .update(t.waitlistOpenings)
          .set({ status: "closed", updatedAt: now })
          .where(eq(t.waitlistOpenings.id, opening.id));
        return;
      }

      const day = localDay(opening.startsAt, settings.timezone);
      const already = opening.offeredEntryIds ?? [];
      const notYet = already.length
        ? sql`${t.slotWaitlist.id}::text <> ALL (ARRAY[${sql.join(
            already.map((id) => sql`${id}`),
            sql`, `,
          )}]::text[])`
        : undefined;
      const candidates = await tx
        .select()
        .from(t.slotWaitlist)
        .where(
          and(
            eq(t.slotWaitlist.status, "waiting"),
            lt(t.slotWaitlist.missedOffers, 2),
            lte(t.slotWaitlist.dateFrom, day),
            gte(t.slotWaitlist.dateTo, day),
            notYet,
          ),
        )
        .orderBy(asc(t.slotWaitlist.createdAt), asc(t.slotWaitlist.id))
        .limit(20);

      const offeredIds = [...already];
      let failures = 0;
      for (const entry of candidates) {
        if (failures >= MAX_SMS_FAILURES) break;
        const fit = await fitEntry(slug, entry, opening, settings.timezone, now);
        if (!fit) continue;

        const [client] = await tx
          .select({ name: t.clients.name, phone: t.clients.phone })
          .from(t.clients)
          .where(eq(t.clients.id, entry.clientId))
          .limit(1);
        if (!client?.phone) {
          offeredIds.push(entry.id);
          failures += 1;
          continue;
        }

        const token = newPublicToken();
        const expires = new Date(now.getTime() + settings.holdMinutes * MIN);
        const offeredEnd = new Date(opening.startsAt.getTime() + fit.totalMinutes * MIN);
        const claimed = await tx
          .update(t.slotWaitlist)
          .set({
            status: "offered",
            openingId: opening.id,
            offerTokenHash: hashPublicToken(token),
            offerExpiresAt: expires,
            offeredStaffId: opening.staffId,
            offeredStart: opening.startsAt,
            offeredEnd,
            offeredLocationId: opening.locationId,
            notifiedAt: now,
            updatedAt: now,
          })
          .where(and(eq(t.slotWaitlist.id, entry.id), eq(t.slotWaitlist.status, "waiting")))
          .returning({ id: t.slotWaitlist.id });
        if (claimed.length === 0) continue;

        const sent = await textOffer({
          slug,
          to: client.phone,
          clientId: entry.clientId,
          clientName: client.name,
          staffId: opening.staffId,
          serviceNames: fit.serviceNames,
          start: opening.startsAt,
          timezone: settings.timezone,
          holdMinutes: settings.holdMinutes,
          token,
        });
        offeredIds.push(entry.id);
        if (!sent) {
          await tx
            .update(t.slotWaitlist)
            .set({
              status: "waiting",
              openingId: null,
              offerTokenHash: null,
              offerExpiresAt: null,
              offeredStaffId: null,
              offeredStart: null,
              offeredEnd: null,
              offeredLocationId: null,
              notifiedAt: null,
              updatedAt: now,
            })
            .where(eq(t.slotWaitlist.id, entry.id));
          failures += 1;
          continue;
        }

        await tx
          .update(t.waitlistOpenings)
          .set({
            status: "offered",
            attempts: opening.attempts + 1,
            offeredEntryIds: offeredIds,
            updatedAt: now,
          })
          .where(eq(t.waitlistOpenings.id, opening.id));
        return;
      }

      await tx
        .update(t.waitlistOpenings)
        .set({ status: "closed", offeredEntryIds: offeredIds, updatedAt: now })
        .where(eq(t.waitlistOpenings.id, opening.id));
    }),
  );
}

async function fitEntry(
  slug: string,
  entry: {
    clientId: string;
    serviceIds: string[];
    staffId: string | null;
    locationId: string | null;
    dateFrom: string;
    dateTo: string;
    timeFrom: string;
    timeTo: string;
  },
  opening: { staffId: string; locationId: string | null; startsAt: Date },
  tz: string,
  now: Date,
): Promise<{ totalMinutes: number; serviceNames: string[] } | null> {
  const serviceIds = entry.serviceIds ?? [];
  if (serviceIds.length === 0) return null;
  const offered = await withTenantDb(slug, async (db, { staffServices }) =>
    db
      .select({ serviceId: staffServices.serviceId })
      .from(staffServices)
      .where(
        and(
          eq(staffServices.staffId, opening.staffId),
          eq(staffServices.isOffered, 1),
          inArray(staffServices.serviceId, serviceIds),
        ),
      ),
  );
  if (new Set(offered.map((r) => r.serviceId)).size !== new Set(serviceIds).size) return null;

  const duration = await getMultiServiceDuration(serviceIds, entry.clientId, opening.staffId, slug);
  if (duration.totalMinutes <= 0 || duration.services.length === 0) return null;
  const end = new Date(opening.startsAt.getTime() + duration.totalMinutes * MIN);
  const day = localDay(opening.startsAt, tz);
  const endHHmm = localDay(end, tz) === day ? clock(end, tz) : "24:00";
  if (
    !entryFits(
      {
        dateFrom: entry.dateFrom,
        dateTo: entry.dateTo,
        timeFrom: entry.timeFrom,
        timeTo: entry.timeTo,
        staffId: entry.staffId,
        locationId: entry.locationId,
      },
      {
        day,
        startHHmm: clock(opening.startsAt, tz),
        endHHmm,
        staffId: opening.staffId,
        locationId: opening.locationId,
      },
    )
  ) {
    return null;
  }

  const guard = await checkBooking({
    slug,
    staffId: opening.staffId,
    start: opening.startsAt,
    services: duration.services.map((s) => ({
      serviceId: s.serviceId,
      durationMinutes: s.durationMinutes,
    })),
    totalMinutes: duration.totalMinutes,
    locationId: opening.locationId,
    mode: "public",
    clientId: entry.clientId,
    now,
  });
  if (!guard.ok) return null;
  return {
    totalMinutes: duration.totalMinutes,
    serviceNames: duration.services.map((s) => s.serviceName),
  };
}

async function textOffer(p: {
  slug: string;
  to: string;
  clientId: string;
  clientName: string;
  staffId: string;
  serviceNames: string[];
  start: Date;
  timezone: string;
  holdMinutes: number;
  token: string;
}): Promise<boolean> {
  const [staffName, business] = await Promise.all([
    withTenantDb(p.slug, async (db, { staff }) => {
      const [row] = await db
        .select({ name: staff.displayName })
        .from(staff)
        .where(eq(staff.id, p.staffId))
        .limit(1);
      return row?.name ?? "";
    }),
    getTenantBySlug(p.slug).then((tenant) => tenant?.name ?? ""),
  ]);
  const local = new TZDate(p.start, p.timezone);
  const result = await sendSms({
    to: p.to,
    body: renderSmsTemplate(DEFAULT_SMS_WAITLIST_OFFER_TEMPLATE, {
      client: p.clientName,
      staff: staffName,
      date: format(local, "EEE, MMM d"),
      time: format(local, "h:mm a"),
      services: p.serviceNames.join(", "),
      business,
      minutes: String(p.holdMinutes),
      link: `${getBaseUrl()}/book/${p.slug}/claim/${p.token}`,
    }),
    tenantSlug: p.slug,
    clientId: p.clientId,
    messageType: "waitlist_offer",
  });
  return result.success;
}

const clearedOffer = {
  openingId: null,
  offerTokenHash: null,
  offerExpiresAt: null,
  offeredStaffId: null,
  offeredStart: null,
  offeredEnd: null,
  offeredLocationId: null,
} as const;

/** An expired hold counts as a miss. Two misses retire the entry. The opening is offered again. */
export async function expireOffers(slug: string, now = new Date()): Promise<void> {
  const rows = await withTenantDb(slug, async (db, { slotWaitlist }) =>
    db
      .select({
        id: slotWaitlist.id,
        missedOffers: slotWaitlist.missedOffers,
        openingId: slotWaitlist.openingId,
      })
      .from(slotWaitlist)
      .where(and(eq(slotWaitlist.status, "offered"), lte(slotWaitlist.offerExpiresAt, now))),
  );

  for (const row of rows) {
    const missed = row.missedOffers + 1;
    await withTenantDb(slug, async (db, t) => {
      await db
        .update(t.slotWaitlist)
        .set({
          missedOffers: missed,
          status: missed >= 2 ? "expired" : "waiting",
          ...clearedOffer,
          updatedAt: now,
        })
        .where(and(eq(t.slotWaitlist.id, row.id), eq(t.slotWaitlist.status, "offered")));
      if (row.openingId) {
        await db
          .update(t.waitlistOpenings)
          .set({ status: "open", updatedAt: now })
          .where(and(eq(t.waitlistOpenings.id, row.openingId), eq(t.waitlistOpenings.status, "offered")));
      }
    });
    if (row.openingId) await processOpening(slug, row.openingId, now);
  }
}

export async function runWaitlistCron(slug: string, now = new Date()): Promise<void> {
  await expireOffers(slug, now);
  const settings = await loadSettings(slug);
  const horizon = new Date(now.getTime() + OFFER_LEAD_MS);
  const open = await withTenantDb(slug, async (db, { waitlistOpenings }) =>
    db
      .select({ id: waitlistOpenings.id })
      .from(waitlistOpenings)
      .where(and(eq(waitlistOpenings.status, "open"), sql`${waitlistOpenings.startsAt} > ${horizon.toISOString()}::timestamptz`)),
  );
  for (const row of open) await processOpening(slug, row.id, now);

  await withTenantDb(slug, async (db, t) => {
    await db
      .update(t.waitlistOpenings)
      .set({ status: "closed", updatedAt: now })
      .where(
        and(
          eq(t.waitlistOpenings.status, "open"),
          lte(t.waitlistOpenings.startsAt, horizon),
        ),
      );
    const today = localDay(now, settings.timezone);
    await db
      .update(t.slotWaitlist)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(t.slotWaitlist.status, "waiting"), lt(t.slotWaitlist.dateTo, today)));
  });
}

/** The claimed hold becomes a booking and the opening is filled. Offer columns stay for the record. */
export async function markOfferBooked(slug: string, entryId: string, appointmentId: string, now = new Date()): Promise<void> {
  const openingId = await withTenantDb(slug, async (db, t) => {
    const [row] = await db
      .update(t.slotWaitlist)
      .set({ status: "booked", bookedAppointmentId: appointmentId, updatedAt: now })
      .where(eq(t.slotWaitlist.id, entryId))
      .returning({ openingId: t.slotWaitlist.openingId });
    return row?.openingId ?? null;
  });
  if (!openingId) return;
  await withTenantDb(slug, async (db, { waitlistOpenings }) => {
    await db
      .update(waitlistOpenings)
      .set({ status: "filled", updatedAt: now })
      .where(eq(waitlistOpenings.id, openingId));
  });
}

export async function declineOffer(slug: string, token: string, now = new Date()): Promise<void> {
  const hash = hashPublicToken(token);
  const row = await withTenantDb(slug, async (db, { slotWaitlist }) => {
    const [found] = await db
      .select({ id: slotWaitlist.id, status: slotWaitlist.status, openingId: slotWaitlist.openingId })
      .from(slotWaitlist)
      .where(eq(slotWaitlist.offerTokenHash, hash))
      .limit(1);
    return found ?? null;
  });
  if (!row || row.status !== "offered") return;

  await withTenantDb(slug, async (db, t) => {
    await db
      .update(t.slotWaitlist)
      .set({ status: "waiting", ...clearedOffer, updatedAt: now })
      .where(and(eq(t.slotWaitlist.id, row.id), eq(t.slotWaitlist.status, "offered")));
    if (row.openingId) {
      await db
        .update(t.waitlistOpenings)
        .set({ status: "open", updatedAt: now })
        .where(and(eq(t.waitlistOpenings.id, row.openingId), eq(t.waitlistOpenings.status, "offered")));
    }
  });
  if (row.openingId) await processOpening(slug, row.openingId, now);
}
