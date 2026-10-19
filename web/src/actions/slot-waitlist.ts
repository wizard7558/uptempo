"use server";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { withTenantDb } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { assertModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { normalizePhone } from "@/lib/phone";
import { daysBetween, localDay } from "@/lib/scheduling/intervals";
import { timeOfDayRange, type TimeOfDay } from "@/lib/waitlist/match";
import { processOpening } from "@/lib/waitlist/opening";
import { recordSmsConsent } from "@/lib/sms/consent";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOLD = [10, 15, 30, 60] as const;

type Failure = { success: false; error: string };

async function staffGuard() {
  const auth = await requireRole("owner", "admin", "provider", "assistant");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = auth.tenantSlug;
  await assertModule(slug, "slot_waitlist");
  return { slug, userId: auth.userId };
}

async function adminGuard() {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = auth.tenantSlug;
  await assertModule(slug, "slot_waitlist");
  return { slug };
}

export type WaitlistRow = {
  id: string;
  clientName: string;
  servicesLabel: string;
  staffName: string | null;
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  status: string;
  offerExpiresAt: string | null;
};

export type WaitlistPageData = {
  timezone: string;
  holdMinutes: number;
  rows: WaitlistRow[];
  services: { id: string; name: string }[];
  staff: { id: string; name: string }[];
};

function asDay(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export async function listSlotWaitlist(): Promise<WaitlistPageData> {
  await requireStaff();
  const { slug } = await staffGuard();
  return withTenantDb(slug, async (db, t) => {
    const [settings] = await db
      .select({
        timezone: t.businessSettings.timezone,
        holdMinutes: t.businessSettings.waitlistHoldMinutes,
      })
      .from(t.businessSettings)
      .limit(1);
    const services = await db
      .select({ id: t.services.id, name: t.services.name, isActive: t.services.isActive })
      .from(t.services)
      .orderBy(asc(t.services.name));
    const staff = await db
      .select({ id: t.staff.id, name: t.staff.displayName })
      .from(t.staff)
      .where(and(eq(t.staff.isActive, 1), eq(t.staff.role, "provider")))
      .orderBy(asc(t.staff.displayName));
    const rows = await db
      .select({
        id: t.slotWaitlist.id,
        clientName: t.clients.name,
        serviceIds: t.slotWaitlist.serviceIds,
        staffName: t.staff.displayName,
        dateFrom: t.slotWaitlist.dateFrom,
        dateTo: t.slotWaitlist.dateTo,
        timeFrom: t.slotWaitlist.timeFrom,
        timeTo: t.slotWaitlist.timeTo,
        status: t.slotWaitlist.status,
        offerExpiresAt: t.slotWaitlist.offerExpiresAt,
      })
      .from(t.slotWaitlist)
      .innerJoin(t.clients, eq(t.clients.id, t.slotWaitlist.clientId))
      .leftJoin(t.staff, eq(t.staff.id, t.slotWaitlist.staffId))
      .where(inArray(t.slotWaitlist.status, ["waiting", "offered", "booked", "expired"]))
      .orderBy(desc(t.slotWaitlist.createdAt));
    const names = new Map(services.map((s) => [s.id, s.name]));
    return {
      timezone: settings?.timezone ?? "America/New_York",
      holdMinutes: settings?.holdMinutes ?? 15,
      services: services.filter((s) => s.isActive === 1).map(({ id, name }) => ({ id, name })),
      staff,
      rows: rows.map((row) => ({
        id: row.id,
        clientName: row.clientName,
        servicesLabel: row.serviceIds.map((id) => names.get(id)).filter(Boolean).join(", "),
        staffName: row.staffName,
        dateFrom: asDay(row.dateFrom),
        dateTo: asDay(row.dateTo),
        timeFrom: row.timeFrom,
        timeTo: row.timeTo,
        status: row.status,
        offerExpiresAt: row.offerExpiresAt ? row.offerExpiresAt.toISOString() : null,
      })),
    };
  });
}

const addSchema = z.object({
  clientId: z.string().uuid(),
  phone: z.string().optional(),
  serviceIds: z.array(z.string().uuid()).min(1).max(5),
  staffId: z.string().uuid().nullable(),
  locationId: z.string().uuid().nullable(),
  dateFrom: z.string().regex(DAY),
  dateTo: z.string().regex(DAY),
  timeOfDay: z.enum(["any", "morning", "afternoon", "evening"]),
  smsConsent: z.boolean(),
});

export type AddToSlotWaitlistInput = z.input<typeof addSchema>;

export async function addToSlotWaitlist(input: AddToSlotWaitlistInput): Promise<{ success: true } | Failure> {
  await requireStaff();
  const { slug, userId } = await staffGuard();
  const te = await getT("errors", slug);
  const tw = await getT("waitlist", slug);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: te("waitlist.badDates") };
  const data = parsed.data;

  const tz = await withTenantDb(slug, async (db, { businessSettings }) => {
    const [row] = await db.select({ timezone: businessSettings.timezone }).from(businessSettings).limit(1);
    return row?.timezone ?? "America/New_York";
  });
  let span = 0;
  try {
    span = daysBetween(data.dateFrom, data.dateTo);
  } catch {
    return { success: false, error: te("waitlist.badDates") };
  }
  if (data.dateFrom < localDay(new Date(), tz) || span < 0 || span > 60) {
    return { success: false, error: te("waitlist.badDates") };
  }

  const count = await withTenantDb(slug, async (db, { slotWaitlist }) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(slotWaitlist)
      .where(and(eq(slotWaitlist.clientId, data.clientId), inArray(slotWaitlist.status, ["waiting", "offered"])));
    return row?.n ?? 0;
  });
  if (count >= 5) return { success: false, error: te("waitlist.tooMany") };

  const client = await withTenantDb(slug, async (db, { clients }) => {
    const [row] = await db.select({ phone: clients.phone }).from(clients).where(eq(clients.id, data.clientId)).limit(1);
    return row ?? null;
  });
  if (!client) return { success: false, error: te("waitlist.needsSession") };

  let phone = client.phone ? normalizePhone(client.phone) : null;
  if (!phone) {
    phone = normalizePhone(data.phone);
    if (!phone) return { success: false, error: tw("admin.noPhone") };
    const saved = phone;
    try {
      await withTenantDb(slug, async (db, { clients }) => {
        await db.update(clients).set({ phone: saved }).where(eq(clients.id, data.clientId));
      });
    } catch (err) {
      if (pgErrorInfo(err).code === "23505") return { success: false, error: te("waitlist.invalidPhone") };
      throw err;
    }
  }
  if (!data.smsConsent) return { success: false, error: te("waitlist.needsConsent") };
  await recordSmsConsent(slug, data.clientId, phone, "admin_toggle", userId);

  const window = timeOfDayRange(data.timeOfDay as TimeOfDay);
  await withTenantDb(slug, async (db, { slotWaitlist }) => {
    await db.insert(slotWaitlist).values({
      clientId: data.clientId,
      serviceIds: data.serviceIds,
      staffId: data.staffId,
      locationId: data.locationId,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      timeFrom: window.from,
      timeTo: window.to,
      source: "front_desk",
    });
  });
  revalidatePath("/slot-waitlist");
  return { success: true };
}

export async function removeFromSlotWaitlist(input: { id: string }): Promise<{ success: true } | Failure> {
  await requireStaff();
  const { slug } = await staffGuard();
  const id = z.string().uuid().safeParse(input.id);
  if (!id.success) return { success: false, error: (await getT("errors", slug))("waitlist.badDates") };
  const row = await withTenantDb(slug, async (db, { slotWaitlist }) => {
    const [found] = await db
      .select({ id: slotWaitlist.id, status: slotWaitlist.status, openingId: slotWaitlist.openingId })
      .from(slotWaitlist)
      .where(eq(slotWaitlist.id, id.data))
      .limit(1);
    return found ?? null;
  });
  if (!row || row.status === "cancelled" || row.status === "booked") {
    revalidatePath("/slot-waitlist");
    return { success: true };
  }
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
  revalidatePath("/slot-waitlist");
  return { success: true };
}

export async function updateWaitlistHold(minutes: number): Promise<{ success: true } | Failure> {
  await requireStaff("owner", "admin");
  const { slug } = await adminGuard();
  if (!HOLD.includes(minutes as (typeof HOLD)[number])) {
    return { success: false, error: (await getT("waitlist", slug))("admin.holdInvalid") };
  }
  await withTenantDb(slug, async (db, { businessSettings }) => {
    await db.update(businessSettings).set({ waitlistHoldMinutes: minutes });
  });
  revalidatePath("/slot-waitlist");
  return { success: true };
}
