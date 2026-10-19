"use server";

import { headers } from "next/headers";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenantDb } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { hasModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { normalizePhone } from "@/lib/phone";
import { clientIpFrom } from "@/lib/http/client-ip";
import { hashPublicToken, isPublicTokenShape, newPublicToken, safeEqualHex } from "@/lib/security/public-token";
import { runAfterResponse } from "@/lib/utils/after";
import { renderSmsTemplate, DEFAULT_SMS_QUEUE_JOINED_TEMPLATE } from "@/lib/sms/template";
import { sendSms } from "@/lib/sms/send";
import { getBaseUrl } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics/events";
import { findClientByPhoneForTenant, createClientForTenant } from "@/lib/clients/for-tenant";
import { recordSmsConsent } from "@/lib/sms/consent";
import { getBusinessBySlug } from "@/actions/booking-public";
import { loadQueueBoard } from "@/lib/queue/board";

/**
 * The public walk-in line: what the join page shows, joining, and leaving.
 * Every action takes an explicit slug (these run without a staff session), checks
 * its shape, and checks that the walk_in_queue module is on. The token hash is
 * never returned.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const HOUR_MS = 3_600_000;

export type QueueJoinInfo = {
  businessName: string;
  open: boolean;
  full: boolean;
  waitingCount: number;
  waitNowMinutes: number | null;
  locations: { id: string; name: string }[];
  services: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  /** True when the kiosk token passed in matches the saved one. */
  kioskValid: boolean;
  /** First name and last initial with position. Filled only for a valid kiosk token. */
  waitingNames: { name: string; position: number }[];
};

export type QueueJoinInfoResult = ({ success: true } & QueueJoinInfo) | { success: false; error: string };

export type JoinQueueInput = {
  slug: string;
  locationId: string | null;
  name: string;
  phone: string;
  serviceId: string | null;
  preferredStaffId: string | null;
  smsConsent: boolean;
  kioskToken?: string;
  website?: string;
};

export type JoinQueueResult =
  | { success: true; token: string; position: number; waitMinutes: number | null }
  | { success: false; error: string };

const joinSchema = z.object({
  name: z.string().trim().min(1).max(80),
  locationId: z.string().uuid().nullable(),
  serviceId: z.string().uuid().nullable(),
  preferredStaffId: z.string().uuid().nullable(),
});

/** "Maria Lopez Garcia" becomes "Maria G." Single names stay as they are. */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
}

async function gate(slug: string): Promise<string | null> {
  if (!SLUG_RE.test(slug) || !(await hasModule(slug, "walk_in_queue"))) {
    return (await getT("errors", SLUG_RE.test(slug) ? slug : null))("queue.turnedOff");
  }
  return null;
}

function kioskTokenOk(token: string | undefined, hash: string | null | undefined): boolean {
  return Boolean(token && hash && safeEqualHex(hashPublicToken(token), hash));
}

export async function getQueueJoinInfo(
  slug: string,
  locationId: string | null,
  kioskToken?: string,
): Promise<QueueJoinInfoResult> {
  const off = await gate(slug);
  if (off) return { success: false, error: off };
  if (locationId !== null && !z.string().uuid().safeParse(locationId).success) {
    return { success: false, error: (await getT("errors", slug))("queue.turnedOff") };
  }

  const [business, board, lists] = await Promise.all([
    getBusinessBySlug(slug),
    loadQueueBoard(slug, locationId, new Date(), { cached: true }),
    withTenantDb(slug, async (db, t) => {
      const [settings] = await db
        .select({ kioskHash: t.businessSettings.queueKioskTokenHash })
        .from(t.businessSettings)
        .limit(1);
      const locations = await db
        .select({ id: t.locations.id, name: t.locations.name })
        .from(t.locations)
        .where(eq(t.locations.isActive, 1))
        .orderBy(asc(t.locations.createdAt), asc(t.locations.id));
      const providers = await db
        .select({ id: t.staff.id, name: t.staff.displayName })
        .from(t.staff)
        .where(and(eq(t.staff.isActive, 1), eq(t.staff.role, "provider")))
        .orderBy(asc(t.staff.displayName));
      const offered = await db
        .selectDistinct({ id: t.services.id, name: t.services.name })
        .from(t.services)
        .innerJoin(t.staffServices, eq(t.staffServices.serviceId, t.services.id))
        .innerJoin(t.staff, eq(t.staff.id, t.staffServices.staffId))
        .where(
          and(
            eq(t.services.isActive, 1),
            eq(t.services.onlineBookable, 1),
            eq(t.staffServices.isOffered, 1),
            eq(t.staff.isActive, 1),
            eq(t.staff.role, "provider"),
          ),
        )
        .orderBy(asc(t.services.name));
      return { kioskHash: settings?.kioskHash ?? null, locations, providers, offered };
    }),
  ]);

  const isKiosk = kioskTokenOk(kioskToken, lists.kioskHash);
  return {
    success: true,
    businessName: business?.name ?? "",
    open: board.open,
    full: board.waiting.length >= board.maxWaiting,
    waitingCount: board.waiting.length,
    waitNowMinutes: board.waitNowMinutes,
    locations: lists.locations,
    services: lists.offered,
    staff: lists.providers,
    kioskValid: isKiosk,
    waitingNames: isKiosk ? board.waiting.map((w) => ({ name: shortName(w.name), position: w.position })) : [],
  };
}

export async function joinQueue(input: JoinQueueInput): Promise<JoinQueueResult> {
  const { slug } = input;
  const off = await gate(slug);
  if (off) return { success: false, error: off };
  const te = await getT("errors", slug);
  const fail = (key: string): JoinQueueResult => ({ success: false, error: te(`queue.${key}`) });

  // 1. Validate. A filled honeypot looks like a rate limit to the bot.
  if (input.website && input.website.trim() !== "") return fail("tooMany");
  const parsed = joinSchema.safeParse({
    name: input.name,
    locationId: input.locationId,
    serviceId: input.serviceId,
    preferredStaffId: input.preferredStaffId,
  });
  if (!parsed.success) {
    return fail(parsed.error.issues.some((i) => i.path[0] === "name") ? "invalidName" : "closed");
  }
  const phone = normalizePhone(input.phone);
  if (!phone) return fail("invalidPhone");
  const { name, locationId, serviceId, preferredStaffId } = parsed.data;

  // 2-3. Settings: open? kiosk?
  const settings = await withTenantDb(slug, async (db, t) => {
    const [row] = await db
      .select({
        open: t.businessSettings.queueOpen,
        maxWaiting: t.businessSettings.queueMaxWaiting,
        textOnJoin: t.businessSettings.queueTextOnJoin,
        kioskHash: t.businessSettings.queueKioskTokenHash,
      })
      .from(t.businessSettings)
      .limit(1);
    return row;
  });
  if (!settings || settings.open !== 1) return fail("closed");
  const isKiosk = kioskTokenOk(input.kioskToken, settings.kioskHash);
  const source = isKiosk ? "kiosk" : "qr";
  const ipLimit = isKiosk ? 300 : 10;

  // 4. Rate limits.
  const ip = clientIpFrom(await headers());
  const byIp = await consumeRateLimit({
    tenantSlug: slug,
    scope: "ip",
    key: `queue_join:${ip}`,
    limit: ipLimit,
    windowMs: HOUR_MS,
  });
  if (!byIp.allowed) return fail("tooMany");
  const byPhone = await consumeRateLimit({
    tenantSlug: slug,
    scope: "identifier",
    key: `queue_join:${phone}`,
    limit: 3,
    windowMs: HOUR_MS,
  });
  if (!byPhone.allowed) return fail("tooMany");

  // The location (if any) must be a real, active one.
  if (locationId) {
    const found = await withTenantDb(slug, async (db, t) => {
      const rows = await db
        .select({ id: t.locations.id })
        .from(t.locations)
        .where(and(eq(t.locations.id, locationId), eq(t.locations.isActive, 1)))
        .limit(1);
      return rows.length > 0;
    });
    if (!found) return fail("closed");
  }

  // 5. Full?
  const waitingCount = await withTenantDb(slug, async (db, t) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.queueEntries)
      .where(
        and(
          eq(t.queueEntries.status, "waiting"),
          locationId ? eq(t.queueEntries.locationId, locationId) : undefined,
        ),
      );
    return row?.n ?? 0;
  });
  if (waitingCount >= settings.maxWaiting) return fail("full");

  // 6. Client.
  const existing = await findClientByPhoneForTenant(slug, phone);
  let clientId: string | null = existing?.id ?? null;
  if (!clientId) {
    const created = await createClientForTenant(slug, { name, phone });
    clientId = created.success ? created.id : null;
  }

  // 7. Consent ledger.
  if (input.smsConsent && clientId) {
    await recordSmsConsent(slug, clientId, phone, "queue_join", ip);
  }

  // 8. Insert. The token is stored only as a hash.
  const token = newPublicToken();
  let entryId: string;
  try {
    entryId = await withTenantDb(slug, async (db, t) => {
      const [row] = await db
        .insert(t.queueEntries)
        .values({
          locationId,
          clientId,
          name,
          phone,
          serviceId,
          preferredStaffId,
          source,
          publicTokenHash: hashPublicToken(token),
        })
        .returning({ id: t.queueEntries.id });
      return row.id;
    });
  } catch (err) {
    const info = pgErrorInfo(err);
    if (info.code === "23505" && info.constraint === "queue_entries_phone_active_unique") {
      return fail("alreadyInLine");
    }
    throw err;
  }

  // 9. Quote the wait from a fresh board.
  const board = await loadQueueBoard(slug, locationId);
  const mine = board.waiting.find((w) => w.id === entryId);
  const position = mine?.position ?? board.waiting.length;
  const waitMinutes = mine?.waitMinutes ?? null;
  if (waitMinutes !== null) {
    await withTenantDb(slug, async (db, t) => {
      await db.update(t.queueEntries).set({ quotedWaitMin: waitMinutes }).where(eq(t.queueEntries.id, entryId));
    });
  }

  // 10. Text the link, after the response.
  if (input.smsConsent && settings.textOnJoin) {
    const business = await getBusinessBySlug(slug);
    const clientIdForSms = clientId ?? undefined;
    runAfterResponse(() =>
      sendSms({
        to: phone,
        body: renderSmsTemplate(DEFAULT_SMS_QUEUE_JOINED_TEMPLATE, {
          client: name,
          staff: "",
          date: "",
          time: "",
          services: "",
          business: business?.name ?? "",
          link: `${getBaseUrl()}/q/${slug}/e/${token}`,
        }),
        tenantSlug: slug,
        clientId: clientIdForSms,
        messageType: "queue_joined",
      }),
    );
  }

  // 11. Analytics.
  trackEvent("queue.joined", { source }, { tenantSlug: slug });

  return { success: true, token, position, waitMinutes };
}

/** Leaves the line. Only a waiting or called entry changes; anything else is a quiet no-op. */
export async function leaveQueue(slug: string, token: string): Promise<{ success: boolean; error?: string }> {
  const off = await gate(slug);
  if (off) return { success: false, error: off };
  if (!isPublicTokenShape(token)) return { success: false };
  const hash = hashPublicToken(token);
  await withTenantDb(slug, async (db, t) => {
    await db
      .update(t.queueEntries)
      .set({ status: "left", leftAt: new Date(), updatedAt: new Date() })
      .where(and(eq(t.queueEntries.publicTokenHash, hash), inArray(t.queueEntries.status, ["waiting", "called"])));
  });
  return { success: true };
}
