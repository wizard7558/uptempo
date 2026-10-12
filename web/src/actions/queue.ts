"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { withTenantDb } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { assertModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import { normalizePhone } from "@/lib/phone";
import { hashPublicToken, newPublicToken } from "@/lib/security/public-token";
import { runAfterResponse } from "@/lib/utils/after";
import { renderSmsTemplate, DEFAULT_SMS_QUEUE_CALLED_TEMPLATE, DEFAULT_SMS_QUEUE_JOINED_TEMPLATE } from "@/lib/sms/template";
import { sendSms } from "@/lib/sms/send";
import { getBaseUrl } from "@/lib/utils";
import { loadQueueBoard, type QueueBoardEntry } from "@/lib/queue/board";
import { beginService, claimEntry, endService, type ClaimedEntry } from "@/lib/queue/line";
import { findClientByPhoneForTenant, createClientForTenant } from "@/lib/clients/for-tenant";
import { recordSmsConsent } from "@/lib/sms/consent";
import { getSalonBySlug } from "@/actions/booking-public";

/**
 * Front-desk actions for the walk-in line. Every action needs a team session and
 * the walk_in_queue module. Settings and kiosk links are for owners and admins.
 */

type Failure = { success: false; error: string };
const fail = (error: string): Failure => ({ success: false, error });

const uuid = z.string().uuid();

/** Team session + module gate for the daily board actions. */
async function staffGuard() {
  const auth = await requireRole("owner", "admin", "provider", "assistant");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  await assertModule(slug, "walk_in_queue");
  return { slug, userId: auth.userId, te: await getT("errors", slug) };
}

/** Session + module gate for the settings actions. */
async function adminGuard() {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  await assertModule(slug, "walk_in_queue");
  return { slug, userId: auth.userId, te: await getT("errors", slug) };
}

const refresh = () => revalidatePath("/walk-ins");

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** A line entry as the browser sees it: dates are ISO strings, the phone is only its last 4 digits. */
export type QueueEntryView = Omit<QueueBoardEntry, "phone" | "joinedAt" | "calledAt" | "startedAt"> & {
  phoneLast4: string | null;
  joinedAt: string;
  calledAt: string | null;
  startedAt: string | null;
};

export type QueueBoardView = {
  open: boolean;
  maxWaiting: number;
  textOnJoin: boolean;
  timezone: string;
  waitNowMinutes: number | null;
  /** Server clock, so "waiting 12 min" does not depend on the tablet's clock. */
  now: string;
  staff: { id: string; name: string; freeAt: string | null }[];
  waiting: (QueueEntryView & { position: number; waitMinutes: number | null })[];
  called: QueueEntryView[];
  inService: QueueEntryView[];
  locations: { id: string; name: string }[];
  services: { id: string; name: string }[];
};

function toView(e: QueueBoardEntry): QueueEntryView {
  const { phone, joinedAt, calledAt, startedAt, ...rest } = e;
  const digits = (phone ?? "").replace(/\D/g, "");
  return {
    ...rest,
    phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
    joinedAt: joinedAt.toISOString(),
    calledAt: calledAt?.toISOString() ?? null,
    startedAt: startedAt?.toISOString() ?? null,
  };
}

export async function getQueueBoard(locationId: string | null): Promise<QueueBoardView> {
  await requireStaff();
  const { slug } = await staffGuard();
  const loc = locationId && uuid.safeParse(locationId).success ? locationId : null;
  const now = new Date();
  const [board, lists] = await Promise.all([
    loadQueueBoard(slug, loc, now),
    withTenantDb(slug, async (db, t) => {
      const locations = await db
        .select({ id: t.locations.id, name: t.locations.name })
        .from(t.locations)
        .where(eq(t.locations.isActive, 1))
        .orderBy(asc(t.locations.createdAt), asc(t.locations.id));
      const services = await db
        .select({ id: t.services.id, name: t.services.name })
        .from(t.services)
        .where(eq(t.services.isActive, 1))
        .orderBy(asc(t.services.name));
      return { locations, services };
    }),
  ]);
  return {
    open: board.open,
    maxWaiting: board.maxWaiting,
    textOnJoin: board.textOnJoin,
    timezone: board.timezone,
    waitNowMinutes: board.waitNowMinutes,
    now: now.toISOString(),
    staff: board.staff.map((s) => ({ id: s.id, name: s.name, freeAt: s.freeAt?.toISOString() ?? null })),
    waiting: board.waiting.map((w) => ({ ...toView(w), position: w.position, waitMinutes: w.waitMinutes })),
    called: board.called.map(toView),
    inService: board.inService.map(toView),
    locations: lists.locations,
    services: lists.services,
  };
}

// ---------------------------------------------------------------------------
// Adding people
// ---------------------------------------------------------------------------

const addSchema = z.object({
  locationId: uuid.nullable(),
  name: z.string().trim().min(1).max(80),
  phone: z.string().nullable(),
  serviceId: uuid.nullable(),
  preferredStaffId: uuid.nullable(),
  smsConsent: z.boolean(),
});

export type AddWalkInInput = z.input<typeof addSchema>;

export async function addWalkIn(input: AddWalkInInput): Promise<{ success: true; id: string } | Failure> {
  await requireStaff();
  const { slug, userId, te } = await staffGuard();
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return fail(te(parsed.error.issues.some((i) => i.path[0] === "name") ? "queue.invalidName" : "queue.closed"));
  }
  const { name, locationId, serviceId, preferredStaffId } = parsed.data;
  const rawPhone = parsed.data.phone?.trim() ? parsed.data.phone : null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return fail(te("queue.invalidPhone"));

  let clientId: string | null = null;
  if (phone) {
    const existing = await findClientByPhoneForTenant(slug, phone);
    clientId = existing?.id ?? null;
  }
  if (!clientId) {
    const created = await createClientForTenant(slug, { name, phone });
    clientId = created.success ? created.id : null;
  }
  if (parsed.data.smsConsent && phone && clientId) {
    await recordSmsConsent(slug, clientId, phone, "admin_toggle", userId);
  }

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
          source: "front_desk",
          publicTokenHash: hashPublicToken(token),
        })
        .returning({ id: t.queueEntries.id });
      return row.id;
    });
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const info = pgErrorInfo(err);
    if (info.code === "23505" && info.constraint === "queue_entries_phone_active_unique") {
      return fail(te("queue.alreadyInLine"));
    }
    throw err;
  }

  // Text the status link when the person agreed and the business turned that on.
  if (parsed.data.smsConsent && phone) {
    const board = await loadQueueBoard(slug, locationId);
    if (board.textOnJoin) {
      const salon = await getSalonBySlug(slug);
      runAfterResponse(() =>
        sendSms({
          to: phone,
          body: renderSmsTemplate(DEFAULT_SMS_QUEUE_JOINED_TEMPLATE, {
            client: name,
            staff: "",
            date: "",
            time: "",
            services: "",
            business: salon?.name ?? "",
            link: `${getBaseUrl()}/q/${slug}/e/${token}`,
          }),
          tenantSlug: slug,
          clientId: clientId ?? undefined,
          messageType: "queue_joined",
        }),
      );
    }
  }

  refresh();
  return { success: true, id: entryId };
}

// ---------------------------------------------------------------------------
// Calling, starting, finishing
// ---------------------------------------------------------------------------

export type CallResult =
  | { success: true; entry: Pick<ClaimedEntry, "id" | "name" | "assignedStaffId" | "assignedStaffName"> }
  | { success: true; empty: true }
  | Failure;

/** Texts the person that it's their turn. Runs after the response; a failure never fails the call. */
async function textCalled(slug: string, entry: ClaimedEntry) {
  if (!entry.phone) return;
  const salon = await getSalonBySlug(slug);
  const to = entry.phone;
  runAfterResponse(() =>
    sendSms({
      to,
      body: renderSmsTemplate(DEFAULT_SMS_QUEUE_CALLED_TEMPLATE, {
        client: entry.name,
        staff: entry.assignedStaffName,
        date: "",
        time: "",
        services: "",
        business: salon?.name ?? "",
      }),
      tenantSlug: slug,
      clientId: entry.clientId ?? undefined,
      messageType: "queue_called",
    }),
  );
}

async function finishCall(
  slug: string,
  te: Awaited<ReturnType<typeof getT>>,
  res: Awaited<ReturnType<typeof claimEntry>>,
): Promise<CallResult> {
  if (res.status === "empty") return { success: true, empty: true };
  if (res.status === "stale") return fail(te("queue.stale"));
  if (res.status === "no_service") return fail(te("queue.staffNoService", { name: res.staffName }));
  await textCalled(slug, res.entry).catch(() => undefined);
  refresh();
  const { id, name, assignedStaffId, assignedStaffName } = res.entry;
  return { success: true, entry: { id, name, assignedStaffId, assignedStaffName } };
}

export async function callNext(input: { locationId: string | null; staffId: string }): Promise<CallResult> {
  await requireStaff();
  const { slug, te } = await staffGuard();
  if (!uuid.safeParse(input.staffId).success) return fail(te("queue.stale"));
  const loc = input.locationId && uuid.safeParse(input.locationId).success ? input.locationId : null;
  const res = await claimEntry(slug, { staffId: input.staffId, locationId: loc, entryId: null });
  return finishCall(slug, te, res);
}

export async function callEntry(input: { entryId: string; staffId: string }): Promise<CallResult> {
  await requireStaff();
  const { slug, te } = await staffGuard();
  if (!uuid.safeParse(input.staffId).success || !uuid.safeParse(input.entryId).success) {
    return fail(te("queue.stale"));
  }
  const res = await claimEntry(slug, { staffId: input.staffId, locationId: null, entryId: input.entryId });
  return finishCall(slug, te, res);
}

export async function startService(input: {
  entryId: string;
  serviceId?: string | null;
}): Promise<{ success: true; appointmentId: string } | Failure> {
  await requireStaff();
  const { slug, te } = await staffGuard();
  if (!uuid.safeParse(input.entryId).success) return fail(te("queue.stale"));
  const serviceId = input.serviceId && uuid.safeParse(input.serviceId).success ? input.serviceId : null;
  const res = await beginService(slug, { entryId: input.entryId, serviceId });
  if (res.status === "stale") return fail(te("queue.stale"));
  if (res.status === "need_service") return fail(te("queue.needService"));
  if (res.status === "busy") return fail(te("queue.staffBusy", { name: res.staffName }));
  refresh();
  return { success: true, appointmentId: res.appointmentId };
}

export async function finishService(input: {
  entryId: string;
}): Promise<{ success: true; appointmentId: string | null } | Failure> {
  await requireStaff();
  const { slug, te } = await staffGuard();
  if (!uuid.safeParse(input.entryId).success) return fail(te("queue.stale"));
  const res = await endService(slug, input.entryId);
  if (!res) return fail(te("queue.stale"));
  refresh();
  return { success: true, appointmentId: res.appointmentId };
}

/** From waiting or called: the person left (or did not show up). */
export async function markLeft(input: { entryId: string }): Promise<{ success: true } | Failure> {
  await requireStaff();
  const { slug, te } = await staffGuard();
  if (!uuid.safeParse(input.entryId).success) return fail(te("queue.stale"));
  const now = new Date();
  const rows = await withTenantDb(slug, async (db, t) => {
    return db
      .update(t.queueEntries)
      .set({ status: "left", leftAt: now, updatedAt: now })
      .where(and(eq(t.queueEntries.id, input.entryId), inArray(t.queueEntries.status, ["waiting", "called"])))
      .returning({ id: t.queueEntries.id });
  });
  if (rows.length === 0) return fail(te("queue.stale"));
  refresh();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Settings (owner and admin)
// ---------------------------------------------------------------------------

/** Updates the one settings row, or inserts it when the business has none yet. */
async function saveSettings(
  slug: string,
  values: { queueOpen?: number; queueMaxWaiting?: number; queueTextOnJoin?: number; queueKioskTokenHash?: string },
) {
  await withTenantDb(slug, async (db, t) => {
    const updated = await db
      .update(t.businessSettings)
      .set({ ...values, updatedAt: new Date() })
      .returning({ id: t.businessSettings.id });
    if (updated.length === 0) await db.insert(t.businessSettings).values(values);
  });
}

export async function setQueueOpen(open: boolean): Promise<{ success: true } | Failure> {
  await requireStaff();
  const { slug } = await adminGuard();
  await saveSettings(slug, { queueOpen: open ? 1 : 0 });
  refresh();
  return { success: true };
}

const settingsSchema = z.object({
  maxWaiting: z.number().int().min(1).max(200),
  textOnJoin: z.boolean(),
});

export async function updateQueueSettings(input: {
  maxWaiting: number;
  textOnJoin: boolean;
}): Promise<{ success: true } | Failure> {
  await requireStaff();
  const { slug, te } = await adminGuard();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(te("queue.stale"));
  await saveSettings(slug, {
    queueMaxWaiting: parsed.data.maxWaiting,
    queueTextOnJoin: parsed.data.textOnJoin ? 1 : 0,
  });
  refresh();
  return { success: true };
}

/** Makes a new kiosk link. The old one stops working. The link is shown once; only its hash is kept. */
export async function createKioskLink(): Promise<{ success: true; url: string }> {
  await requireStaff();
  const { slug } = await adminGuard();
  const token = newPublicToken();
  await saveSettings(slug, { queueKioskTokenHash: hashPublicToken(token) });
  refresh();
  return { success: true, url: `${getBaseUrl()}/q/${slug}/kiosk?k=${token}` };
}
