"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { getActorStaffId } from "@/lib/auth/actor-staff";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { assertModule, hasModule, ModuleDisabledError } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { getEmailT } from "@/lib/terms/email";
import { getBusinessSettingsForTenant } from "@/lib/policies/salon-policy";
import { lookupPostalCentroid, nearestPostal, normalizePostal } from "@/lib/geo/postal";
import { localDay } from "@/lib/scheduling/intervals";
import { sendSms } from "@/lib/sms/send";
import { toPlainAscii } from "@/lib/sms/plain-text";
import { renderSmsTemplate } from "@/lib/sms/template";
import { checkServiceArea } from "@/lib/on-site/service-area";
import { loadActiveAreas } from "@/lib/on-site/areas";
import {
  ETA_CHOICES,
  claimOnMyWay,
  loadOnMyWayTarget,
  releaseOnMyWay,
} from "@/lib/on-site/on-my-way";

type Fail = { success: false; error: string };
const fail = (error: string): Fail => ({ success: false, error });

const ARRIVAL_CHOICES = [0, 30, 60, 120, 180, 240] as const;
const ZIP_SHAPE = /^[A-Za-z0-9 -]{3,10}$/;

/** Owner/admin session plus the module gate. */
async function settingsGuard() {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = auth.tenantSlug;
  await assertModule(slug, "on_site");
  const ts = await getT("settings", slug);
  return { slug, ts };
}

function asFailure(err: unknown): Fail {
  if (err instanceof ModuleDisabledError) return fail(err.message);
  throw err;
}

export type ServiceAreaView = {
  id: string;
  name: string;
  kind: "postal_codes" | "radius";
  staffId: string | null;
  staffName: string | null;
  postalCodes: string[];
  radiusKm: number | null;
  /** The ZIP closest to a radius area's center, for the summary line. */
  centerPostal: string | null;
  isActive: boolean;
};

export async function listServiceAreas(): Promise<ServiceAreaView[]> {
  await requireStaff();
  const { slug } = await settingsGuard();
  const rows = await withTenantDb(slug, async (db, { serviceAreas, staff }) =>
    db
      .select({ a: serviceAreas, staffName: staff.displayName })
      .from(serviceAreas)
      .leftJoin(staff, eq(staff.id, serviceAreas.staffId))
      .orderBy(asc(serviceAreas.createdAt)),
  );
  return Promise.all(
    rows.map(async ({ a, staffName }) => ({
      id: a.id,
      name: a.name,
      kind: a.kind as ServiceAreaView["kind"],
      staffId: a.staffId,
      staffName,
      postalCodes: a.postalCodes,
      radiusKm: a.radiusKm == null ? null : Number(a.radiusKm),
      centerPostal:
        a.kind === "radius" && a.centerLat != null && a.centerLng != null
          ? await nearestPostal({ lat: a.centerLat, lng: a.centerLng })
          : null,
      isActive: a.isActive === 1,
    })),
  );
}

const areaSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  staffId: z.uuid().nullable(),
  kind: z.enum(["postal_codes", "radius"]),
  postalCodes: z.array(z.string().trim().regex(ZIP_SHAPE)).max(2000).optional(),
  centerPostal: z.string().trim().max(10).optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().min(1).max(500).optional(),
});
export type SaveServiceAreaInput = z.input<typeof areaSchema>;

export async function saveServiceArea(
  input: SaveServiceAreaInput,
): Promise<{ success: true; id: string } | Fail> {
  await requireStaff();
  try {
    const { slug, ts } = await settingsGuard();
    const parsed = areaSchema.safeParse(input);
    if (!parsed.success) return fail(ts("onSite.invalidArea"));
    const a = parsed.data;

    let values: {
      postalCodes: string[];
      centerLat: number | null;
      centerLng: number | null;
      radiusKm: string | null;
    };
    if (a.kind === "postal_codes") {
      const zips = [...new Set((a.postalCodes ?? []).map((z) => normalizePostal(z)))];
      if (zips.length === 0) return fail(ts("onSite.zipsRequired"));
      values = { postalCodes: zips, centerLat: null, centerLng: null, radiusKm: null };
    } else {
      if (a.radiusKm == null) return fail(ts("onSite.invalidArea"));
      let center: { lat: number; lng: number } | null = null;
      if (a.centerPostal) {
        center = await lookupPostalCentroid(a.centerPostal);
        if (!center) return fail(ts("onSite.postalNotFound"));
      } else if (a.centerLat != null && a.centerLng != null) {
        center = { lat: a.centerLat, lng: a.centerLng };
      }
      if (!center) return fail(ts("onSite.centerRequired"));
      values = {
        postalCodes: [],
        centerLat: center.lat,
        centerLng: center.lng,
        radiusKm: String(a.radiusKm),
      };
    }

    const id = await withTenantDb(slug, async (db, { serviceAreas, staff }) => {
      if (a.staffId) {
        const [member] = await db
          .select({ id: staff.id })
          .from(staff)
          .where(eq(staff.id, a.staffId))
          .limit(1);
        if (!member) return null;
      }
      const row = { name: a.name, staffId: a.staffId, kind: a.kind, ...values, updatedAt: new Date() };
      if (a.id) {
        const updated = await db
          .update(serviceAreas)
          .set(row)
          .where(eq(serviceAreas.id, a.id))
          .returning({ id: serviceAreas.id });
        return updated[0]?.id ?? null;
      }
      const [created] = await db.insert(serviceAreas).values(row).returning({ id: serviceAreas.id });
      return created.id;
    });
    if (!id) return fail(ts("onSite.invalidArea"));
    revalidatePath("/settings/service-areas");
    return { success: true, id };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

export async function setServiceAreaActive(
  id: string,
  active: boolean,
): Promise<{ success: true } | Fail> {
  await requireStaff();
  try {
    const { slug, ts } = await settingsGuard();
    if (!z.uuid().safeParse(id).success) return fail(ts("onSite.invalidArea"));
    await withTenantDb(slug, async (db, { serviceAreas }) =>
      db
        .update(serviceAreas)
        .set({ isActive: active ? 1 : 0, updatedAt: new Date() })
        .where(eq(serviceAreas.id, id)),
    );
    revalidatePath("/settings/service-areas");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

export type TravelSettingsView = {
  staffId: string;
  basePostalCode: string | null;
  baseLat: number;
  baseLng: number;
  maxTravelMin: number;
  travelBufferMin: number;
  speedKmh: number;
};

export async function getTravelSettings(staffId: string): Promise<TravelSettingsView | null> {
  await requireStaff();
  const { slug } = await settingsGuard();
  if (!z.uuid().safeParse(staffId).success) return null;
  const [row] = await withTenantDb(slug, async (db, { staffTravelSettings }) =>
    db.select().from(staffTravelSettings).where(eq(staffTravelSettings.staffId, staffId)).limit(1),
  );
  return row ?? null;
}

const travelSchema = z.object({
  staffId: z.uuid(),
  basePostalCode: z.string().trim().max(10).optional(),
  baseLat: z.number().min(-90).max(90).optional(),
  baseLng: z.number().min(-180).max(180).optional(),
  maxTravelMin: z.number().int().min(5).max(480),
  travelBufferMin: z.number().int().min(0).max(120),
  speedKmh: z.number().int().min(5).max(130),
});
export type SaveTravelSettingsInput = z.input<typeof travelSchema>;

export async function saveTravelSettings(
  input: SaveTravelSettingsInput,
): Promise<{ success: true } | Fail> {
  await requireStaff();
  try {
    const { slug, ts } = await settingsGuard();
    const parsed = travelSchema.safeParse(input);
    if (!parsed.success) return fail(ts("onSite.invalidTravel"));
    const v = parsed.data;

    // A ZIP code wins over typed coordinates.
    let base: { lat: number; lng: number } | null = null;
    let zip: string | null = null;
    if (v.basePostalCode) {
      zip = normalizePostal(v.basePostalCode);
      base = await lookupPostalCentroid(zip);
      if (!base) return fail(ts("onSite.postalNotFound"));
    } else if (v.baseLat != null && v.baseLng != null) {
      base = { lat: v.baseLat, lng: v.baseLng };
    }
    if (!base) return fail(ts("onSite.baseRequired"));

    const saved = await withTenantDb(slug, async (db, { staffTravelSettings, staff }) => {
      const [member] = await db.select({ id: staff.id }).from(staff).where(eq(staff.id, v.staffId)).limit(1);
      if (!member) return false;
      const row = {
        basePostalCode: zip,
        baseLat: base.lat,
        baseLng: base.lng,
        maxTravelMin: v.maxTravelMin,
        travelBufferMin: v.travelBufferMin,
        speedKmh: v.speedKmh,
        updatedAt: new Date(),
      };
      await db
        .insert(staffTravelSettings)
        .values({ staffId: v.staffId, ...row })
        .onConflictDoUpdate({ target: staffTravelSettings.staffId, set: row });
      return true;
    });
    if (!saved) return fail(ts("onSite.invalidTravel"));
    revalidatePath("/settings/staff");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

export async function getArrivalWindow(): Promise<number> {
  await requireStaff();
  const { slug } = await settingsGuard();
  return (await getBusinessSettingsForTenant(slug)).arrivalWindowMin;
}

export async function saveArrivalWindow(minutes: number): Promise<{ success: true } | Fail> {
  await requireStaff();
  try {
    const { slug, ts } = await settingsGuard();
    if (!(ARRIVAL_CHOICES as readonly number[]).includes(minutes)) return fail(ts("onSite.invalidArea"));
    const existing = await getBusinessSettingsForTenant(slug);
    await withTenantDb(slug, async (db, { businessSettings }) =>
      db
        .update(businessSettings)
        .set({ arrivalWindowMin: minutes, updatedAt: new Date() })
        .where(eq(businessSettings.id, existing.id)),
    );
    revalidatePath("/settings/service-areas");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
}

/** Public: can the business come to this ZIP code? Always ok when the module is off or no areas are set. */
export async function checkPostalCodePublic(
  postal: string,
): Promise<{ ok: boolean; message?: string }> {
  const slug = await getTenantSlug();
  if (typeof postal !== "string" || !ZIP_SHAPE.test(postal.trim())) return { ok: true };
  if (!(await hasModule(slug, "on_site"))) return { ok: true };
  const zip = normalizePostal(postal);
  const [point, areas] = await Promise.all([lookupPostalCentroid(zip), loadActiveAreas(slug)]);
  if (checkServiceArea(areas, zip, point, null) === "ok") return { ok: true };
  const t = await getT("requests", slug);
  return { ok: false, message: t("outOfArea", { zip }) };
}

/** Texts the client that the staff member is on the way. At most one text every 30 minutes per job. */
export async function sendOnMyWay(input: {
  appointmentId: string;
  etaMinutes: number;
}): Promise<{ success: true; alreadySent?: true } | Fail> {
  const auth = await requireRole("owner", "admin", "provider", "assistant");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = auth.tenantSlug;
  const ts = await getT("schedule", slug);
  try {
    await assertModule(slug, "on_site");
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  if (
    !z.uuid().safeParse(input.appointmentId).success ||
    !(ETA_CHOICES as readonly number[]).includes(input.etaMinutes)
  ) {
    return fail(ts("onSite.invalidEta"));
  }

  const appt = await loadOnMyWayTarget(slug, input.appointmentId);
  if (!appt) return fail(ts("onSite.notFound"));

  if (auth.role === "provider" || auth.role === "assistant") {
    const actorStaffId = await getActorStaffId(slug, auth.userId);
    if (!actorStaffId || actorStaffId !== appt.staffId) return fail(ts("onSite.notYours"));
  }

  if (appt.status !== "confirmed") return fail(ts("onSite.notConfirmed"));
  if (!appt.serviceAddressId) return fail(ts("onSite.noAddress"));
  if (localDay(appt.start, appt.timezone) !== localDay(new Date(), appt.timezone)) {
    return fail(ts("onSite.notToday"));
  }
  if (!appt.clientPhone) return fail(ts("onSite.noPhone"));

  const claim = await claimOnMyWay(slug, appt.id);
  if (claim === "taken") return { success: true, alreadySent: true };

  const tenant = await getTenantBySlug(slug);
  const et = await getEmailT(slug, "emails");
  // `{staff}` is also a terminology word, so pass it through untouched and let the SMS template fill it.
  const template = et("onMyWay.sms", {
    staff: "{staff}",
    business: tenant?.name ?? "",
    eta: input.etaMinutes,
  });
  const body = toPlainAscii(
    renderSmsTemplate(template, {
      client: appt.clientName,
      staff: appt.staffName.trim().split(/\s+/)[0] ?? appt.staffName,
      date: "",
      time: "",
      services: "",
    }),
  );

  const sent = await sendSms({
    to: appt.clientPhone,
    body,
    tenantSlug: slug,
    clientId: appt.clientId,
    appointmentId: appt.id,
    messageType: "on_my_way",
  });
  if (!sent.success) {
    await releaseOnMyWay(slug, appt.id, claim.previous);
    if (sent.error === "no_consent") return fail(ts("onSite.noPhone"));
    if (sent.error === "quiet_hours") return fail(ts("onSite.quietHours"));
    return fail(ts("onSite.sendFailed"));
  }
  revalidatePath("/schedule");
  return { success: true };
}
