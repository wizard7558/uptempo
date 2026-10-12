import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { withTenantDb, type TenantTransaction } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { enforceAgeGate } from "@/lib/consent/gate";
import { redeemForEnrollment, refundEntry } from "@/lib/credits/ledger";
import { isOnTimeCancel } from "@/lib/credits/cancel";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { findBusyConflicts } from "@/lib/scheduling/service";
import { addDays, wallClockToDate } from "@/lib/scheduling/intervals";
import { getEmailT } from "@/lib/terms/email";
import { notifyClassCancelled, notifyPromoted, type CancelRecipient } from "./notify";

/**
 * The class enrollment engine. Every change to seats goes through here.
 *
 * Serialization: each write takes the class session row `FOR UPDATE`, and the
 * database trigger on class_enrollments adds a per-session advisory lock and the
 * capacity checks, so two people can never take the last seat.
 *
 * Credits: a credit is spent only for a `booked` seat. The ledger insert runs after the
 * enrollment row is written, and inside a savepoint when a failure there must not abort
 * the surrounding transaction.
 *
 * Texts and emails are sent after the transaction commits and never throw.
 */

export type EnrollError =
  | "FULL"
  | "CLOSED"
  | "ALREADY"
  | "STARTED"
  | "UNDERAGE"
  | "DOB_REQUIRED";

export type EnrollResult =
  | { status: "booked" | "waitlisted"; position?: number; creditEntryId?: string }
  | { error: EnrollError };

export type EnrollInput = {
  sessionId: string;
  clientId: string;
  useCredit: boolean;
  actor: "client" | "staff";
  /** A birthday typed by the client for an age-limited class. */
  dob?: string | null;
};

/** The cancellation window used when a business has no settings row yet. */
const DEFAULT_WINDOW_HOURS = 24;

type Locked = {
  id: string;
  serviceId: string;
  status: string;
  capacity: number;
  waitlistCapacity: number;
  during: { start: Date; end: Date };
  timeBlockId: string | null;
};

async function lockSession(tx: TenantTransaction, t: TenantTables, sessionId: string): Promise<Locked | null> {
  const [row] = await tx
    .select({
      id: t.classSessions.id,
      serviceId: t.classSessions.serviceId,
      status: t.classSessions.status,
      capacity: t.classSessions.capacity,
      waitlistCapacity: t.classSessions.waitlistCapacity,
      during: t.classSessions.during,
      timeBlockId: t.classSessions.timeBlockId,
    })
    .from(t.classSessions)
    .where(eq(t.classSessions.id, sessionId))
    .for("update");
  return row ?? null;
}

async function countByStatus(
  tx: TenantTransaction,
  t: TenantTables,
  sessionId: string,
  status: "booked" | "waitlisted",
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(t.classEnrollments)
    .where(and(eq(t.classEnrollments.sessionId, sessionId), eq(t.classEnrollments.status, status)));
  return Number(row?.n ?? 0);
}

/** Waitlist places 1..n with no gaps, in the order people joined. */
async function renumberWaitlist(tx: TenantTransaction, t: TenantTables, sessionId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE ${t.classEnrollments} e SET waitlist_position = r.rn
      FROM (
        SELECT id, row_number() OVER (ORDER BY waitlist_position, created_at) AS rn
          FROM ${t.classEnrollments}
         WHERE session_id = ${sessionId} AND status = 'waitlisted'
      ) r
     WHERE e.id = r.id AND e.waitlist_position IS DISTINCT FROM r.rn
  `);
}

/**
 * Moves the first person on the waitlist into a seat and spends one of their credits when
 * they have a usable pack. The caller has locked the session and checked there is room.
 */
async function promoteNext(
  tx: TenantTransaction,
  t: TenantTables,
  session: Locked,
): Promise<{ enrollmentId: string; clientId: string } | null> {
  const [next] = await tx
    .select({ id: t.classEnrollments.id, clientId: t.classEnrollments.clientId })
    .from(t.classEnrollments)
    .where(and(eq(t.classEnrollments.sessionId, session.id), eq(t.classEnrollments.status, "waitlisted")))
    .orderBy(asc(t.classEnrollments.waitlistPosition))
    .limit(1)
    .for("update", { skipLocked: true });
  if (!next) return null;
  const now = new Date();
  await tx
    .update(t.classEnrollments)
    .set({ status: "booked", promotedAt: now, updatedAt: now })
    .where(eq(t.classEnrollments.id, next.id));
  // A failed ledger insert aborts the transaction, so the credit work runs in a savepoint.
  try {
    await tx.transaction(async (sp) => {
      await redeemForEnrollment(sp, t, {
        clientId: next.clientId,
        serviceIds: [session.serviceId],
        enrollmentId: next.id,
        at: now,
      });
    });
  } catch (err) {
    console.error("[classes] could not use a credit for a promoted spot", err);
  }
  return { enrollmentId: next.id, clientId: next.clientId };
}

/** Promotes while there is room. Returns who moved up, in order. */
async function fillOpenSeats(
  tx: TenantTransaction,
  t: TenantTables,
  session: Locked,
): Promise<{ enrollmentId: string; clientId: string }[]> {
  const promoted: { enrollmentId: string; clientId: string }[] = [];
  let booked = await countByStatus(tx, t, session.id, "booked");
  while (booked < session.capacity) {
    const p = await promoteNext(tx, t, session);
    if (!p) break;
    promoted.push(p);
    booked += 1;
  }
  if (promoted.length > 0) await renumberWaitlist(tx, t, session.id);
  return promoted;
}

function mapEnrollError(err: unknown): EnrollError | null {
  const { code, constraint } = pgErrorInfo(err);
  if (constraint === "class_enrollments_capacity" || constraint === "class_enrollments_waitlist_full") return "FULL";
  if (constraint === "class_enrollments_active_unique" && code === "23505") return "ALREADY";
  if (constraint === "class_enrollments_session_open") return "CLOSED";
  return null;
}

export async function enrollInClass(slug: string, input: EnrollInput): Promise<EnrollResult> {
  const [pre] = await withTenantDb(slug, async (db, t) =>
    db
      .select({ serviceId: t.classSessions.serviceId, during: t.classSessions.during, status: t.classSessions.status })
      .from(t.classSessions)
      .where(eq(t.classSessions.id, input.sessionId))
      .limit(1),
  );
  if (!pre || pre.status !== "scheduled") return { error: "CLOSED" };
  if (pre.during.start.getTime() <= Date.now()) return { error: "STARTED" };

  const gate = await enforceAgeGate(slug, {
    clientId: input.clientId,
    serviceIds: [pre.serviceId],
    start: pre.during.start,
    dobInput: input.dob ?? null,
    strict: input.actor === "client",
  });
  if (!gate.ok) return { error: gate.code };

  try {
    return await withTenantDb(slug, (db, t) =>
      db.transaction(async (tx): Promise<EnrollResult> => {
        const session = await lockSession(tx, t, input.sessionId);
        if (!session || session.status !== "scheduled") return { error: "CLOSED" };
        if (session.during.start.getTime() <= Date.now()) return { error: "STARTED" };

        const [already] = await tx
          .select({ id: t.classEnrollments.id })
          .from(t.classEnrollments)
          .where(
            and(
              eq(t.classEnrollments.sessionId, session.id),
              eq(t.classEnrollments.clientId, input.clientId),
              sql`${t.classEnrollments.status} IN ('booked','waitlisted')`,
            ),
          )
          .limit(1);
        if (already) return { error: "ALREADY" };

        const booked = await countByStatus(tx, t, session.id, "booked");
        if (booked < session.capacity) {
          const [row] = await tx
            .insert(t.classEnrollments)
            .values({ sessionId: session.id, clientId: input.clientId, status: "booked" })
            .returning({ id: t.classEnrollments.id });
          // Credit work goes last: nothing else in this transaction depends on it.
          let creditEntryId: string | undefined;
          if (input.useCredit) {
            const entry = await redeemForEnrollment(tx, t, {
              clientId: input.clientId,
              serviceIds: [session.serviceId],
              enrollmentId: row.id,
            });
            if (entry) creditEntryId = entry;
          }
          return { status: "booked", creditEntryId };
        }

        const waiting = await countByStatus(tx, t, session.id, "waitlisted");
        if (waiting >= session.waitlistCapacity) return { error: "FULL" };
        const [row] = await tx
          .insert(t.classEnrollments)
          .values({ sessionId: session.id, clientId: input.clientId, status: "waitlisted" })
          .returning({ position: t.classEnrollments.waitlistPosition });
        return { status: "waitlisted", position: row.position ?? undefined };
      }),
    );
  } catch (err) {
    const mapped = mapEnrollError(err);
    if (mapped) return { error: mapped };
    throw err;
  }
}

export async function cancelEnrollment(
  slug: string,
  input: { enrollmentId: string; actor: "client" | "staff"; refundCredit?: boolean },
): Promise<{ promotedClientId: string | null }> {
  const promoted = await withTenantDb(slug, async (db, t) => {
    const [pre] = await db
      .select({ sessionId: t.classEnrollments.sessionId })
      .from(t.classEnrollments)
      .where(eq(t.classEnrollments.id, input.enrollmentId))
      .limit(1);
    if (!pre) return null;

    return db.transaction(async (tx) => {
      const session = await lockSession(tx, t, pre.sessionId);
      if (!session) return null;
      const [enr] = await tx
        .select({
          id: t.classEnrollments.id,
          status: t.classEnrollments.status,
          creditEntryId: t.classEnrollments.creditEntryId,
        })
        .from(t.classEnrollments)
        .where(eq(t.classEnrollments.id, input.enrollmentId))
        .for("update");
      if (!enr || (enr.status !== "booked" && enr.status !== "waitlisted")) return null;

      const wasBooked = enr.status === "booked";
      const now = new Date();
      let windowHours = DEFAULT_WINDOW_HOURS;
      if (wasBooked) {
        const [settings] = await tx
          .select({ hours: t.businessSettings.cancellationWindowHours })
          .from(t.businessSettings)
          .limit(1);
        windowHours = settings?.hours ?? DEFAULT_WINDOW_HOURS;
      }
      // A late cancel is the client cancelling inside the window, or staff choosing to keep the credit.
      const late =
        wasBooked &&
        (input.actor === "client"
          ? !isOnTimeCancel(session.during.start, now, windowHours)
          : input.refundCredit === false);

      await tx
        .update(t.classEnrollments)
        .set({ status: late ? "late_cancel" : "cancelled", cancelledAt: now, updatedAt: now })
        .where(eq(t.classEnrollments.id, enr.id));

      if (wasBooked && enr.creditEntryId) {
        const give = input.actor === "client" ? !late : (input.refundCredit ?? true);
        if (give) await refundEntry(tx, t, enr.creditEntryId, "refund");
      }

      if (!wasBooked) {
        await renumberWaitlist(tx, t, session.id);
        return null;
      }
      if (session.status !== "scheduled") return null;
      const moved = await fillOpenSeats(tx, t, session);
      return moved[0] ?? null;
    });
  });

  if (promoted) await notifyPromoted(slug, promoted.enrollmentId);
  return { promotedClientId: promoted?.clientId ?? null };
}

export type SetCapacityResult = { success: true; promoted: number } | { success: false; error: string };

export async function setSessionCapacity(
  slug: string,
  sessionId: string,
  capacity: number,
): Promise<SetCapacityResult> {
  const t = await getEmailT(slug, "classes");
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    return { success: false, error: t("errors.invalid") };
  }
  const result = await withTenantDb(slug, (db, tables) =>
    db.transaction(async (tx): Promise<{ error: string } | { promoted: { enrollmentId: string; clientId: string }[] }> => {
      const session = await lockSession(tx, tables, sessionId);
      if (!session) return { error: t("errors.notFound") };
      if (session.status !== "scheduled") return { error: t("public.errors.CLOSED") };
      const booked = await countByStatus(tx, tables, sessionId, "booked");
      if (capacity < booked) return { error: t("capacityBelowBooked") };
      await tx
        .update(tables.classSessions)
        .set({ capacity, updatedAt: new Date() })
        .where(eq(tables.classSessions.id, sessionId));
      return { promoted: await fillOpenSeats(tx, tables, { ...session, capacity }) };
    }),
  );
  if ("error" in result) return { success: false, error: result.error };
  for (const p of result.promoted) await notifyPromoted(slug, p.enrollmentId);
  return { success: true, promoted: result.promoted.length };
}

export type CancelSessionResult = { success: true; notified: number } | { success: false; error: string };

export async function cancelSession(slug: string, sessionId: string): Promise<CancelSessionResult> {
  const t = await getEmailT(slug, "classes");
  const result = await withTenantDb(slug, (db, tables) =>
    db.transaction(async (tx): Promise<{ error: string } | { recipients: CancelRecipient[] }> => {
      const session = await lockSession(tx, tables, sessionId);
      if (!session) return { error: t("errors.notFound") };
      if (session.status !== "scheduled") return { error: t("public.errors.CLOSED") };

      const heldRows = await tx
        .select({
          id: tables.classEnrollments.id,
          status: tables.classEnrollments.status,
          creditEntryId: tables.classEnrollments.creditEntryId,
          clientId: tables.classEnrollments.clientId,
        })
        .from(tables.classEnrollments)
        .where(
          and(
            eq(tables.classEnrollments.sessionId, sessionId),
            sql`${tables.classEnrollments.status} IN ('booked','waitlisted')`,
          ),
        )
        .for("update");
      const phones = heldRows.length
        ? await tx
            .select({ id: tables.clients.id, phone: tables.clients.phone })
            .from(tables.clients)
            .where(inArray(tables.clients.id, heldRows.map((e) => e.clientId)))
        : [];
      const held = heldRows.map((e) => ({ ...e, phone: phones.find((c) => c.id === e.clientId)?.phone ?? null }));

      const now = new Date();
      await tx
        .update(tables.classSessions)
        .set({ status: "cancelled", updatedAt: now })
        .where(eq(tables.classSessions.id, sessionId));
      // Everyone gets their credit back, whatever the time: the class is not happening.
      for (const e of held) {
        if (e.status === "booked" && e.creditEntryId) await refundEntry(tx, tables, e.creditEntryId, "refund");
      }
      await tx
        .update(tables.classEnrollments)
        .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
        .where(
          and(
            eq(tables.classEnrollments.sessionId, sessionId),
            sql`${tables.classEnrollments.status} IN ('booked','waitlisted')`,
          ),
        );
      if (session.timeBlockId) {
        await tx.delete(tables.timeBlocks).where(eq(tables.timeBlocks.id, session.timeBlockId));
      }
      return {
        recipients: held.filter((e) => e.status === "booked").map((e) => ({ clientId: e.clientId, phone: e.phone })),
      };
    }),
  );
  if ("error" in result) return { success: false, error: result.error };
  await notifyClassCancelled(slug, sessionId, result.recipients);
  return { success: true, notified: result.recipients.filter((r) => r.phone).length };
}

export type CreateClassSessionsInput = {
  serviceId: string;
  staffId: string;
  locationId: string | null;
  resourceId: string | null;
  /** YYYY-MM-DD in the business's timezone. */
  date: string;
  /** HH:mm in the business's timezone. */
  startTime: string;
  capacity: number;
  waitlistCapacity: number;
  priceCents: number | null;
  repeatWeeks: 0 | 4 | 8 | 12 | 26;
  allowConflicts: boolean;
};

export type ClassConflict = { date: string; reason: "appointment" | "block" | "external" | "task" | "class" };

export type CreateClassSessionsResult =
  | { sessionIds: string[] }
  | { conflicts: ClassConflict[] }
  | { error: "INVALID" | "NOT_FOUND" };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function createClassSessions(
  slug: string,
  input: CreateClassSessionsInput,
): Promise<CreateClassSessionsResult> {
  const validCount =
    Number.isInteger(input.capacity) && input.capacity >= 1 && input.capacity <= 500 &&
    Number.isInteger(input.waitlistCapacity) && input.waitlistCapacity >= 0 && input.waitlistCapacity <= 500;
  const validPrice = input.priceCents === null || (Number.isInteger(input.priceCents) && input.priceCents >= 0);
  const validRepeat = [0, 4, 8, 12, 26].includes(input.repeatWeeks);
  if (!DAY_RE.test(input.date) || !TIME_RE.test(input.startTime) || !validCount || !validPrice || !validRepeat) {
    return { error: "INVALID" };
  }

  const [svc] = await withTenantDb(slug, async (db, t) =>
    db
      .select({ name: t.services.name, minutes: t.services.defaultDurationMinutes })
      .from(t.services)
      .where(and(eq(t.services.id, input.serviceId), eq(t.services.isActive, 1)))
      .limit(1),
  );
  const [member] = await withTenantDb(slug, async (db, t) =>
    db.select({ id: t.staff.id }).from(t.staff).where(eq(t.staff.id, input.staffId)).limit(1),
  );
  if (!svc || !member) return { error: "NOT_FOUND" };

  const { timezone } = await loadSchedulingSettings(slug);
  const slots = Array.from({ length: input.repeatWeeks + 1 }, (_, i) => {
    const day = addDays(input.date, 7 * i);
    const start = wallClockToDate(day, input.startTime, timezone);
    return { day, start, end: new Date(start.getTime() + svc.minutes * 60_000) };
  });

  // Appointments can be saved over ("Save anyway"), but two time blocks for one person cannot overlap.
  const found = await Promise.all(
    slots.map(async (s) => {
      const busy = await findBusyConflicts({
        slug,
        staffId: input.staffId,
        start: s.start,
        end: s.end,
        locationId: input.locationId,
        kinds: ["appointment", "block"],
      });
      const hit = input.allowConflicts ? busy.find((b) => b.kind === "block") : busy[0];
      return hit ? ({ date: s.day, reason: hit.kind } as ClassConflict) : null;
    }),
  );
  const conflicts = found.filter((c): c is ClassConflict => c !== null);
  if (conflicts.length > 0) return { conflicts };

  const seriesId = input.repeatWeeks > 0 ? randomUUID() : null;
  const writeSession = (s: { start: Date; end: Date }): Promise<string> =>
    withTenantDb(slug, (db, t) =>
      db.transaction(async (tx) => {
        const now = new Date();
        const [block] = await tx
          .insert(t.timeBlocks)
          .values({
            staffId: input.staffId,
            locationId: input.locationId,
            during: { start: s.start, end: s.end },
            label: `Class: ${svc.name}`,
            updatedAt: now,
          })
          .returning({ id: t.timeBlocks.id });
        const [session] = await tx
          .insert(t.classSessions)
          .values({
            serviceId: input.serviceId,
            staffId: input.staffId,
            locationId: input.locationId,
            resourceId: input.resourceId,
            during: { start: s.start, end: s.end },
            capacity: input.capacity,
            waitlistCapacity: input.waitlistCapacity,
            seriesId,
            timeBlockId: block.id,
            priceCents: input.priceCents,
          })
          .returning({ id: t.classSessions.id });
        return session.id;
      }),
    );
  const sessionIds: string[] = [];
  for (const s of slots) {
    let id: string;
    try {
      id = await writeSession(s);
    } catch (err) {
      // Lost a race with another block for the same person.
      if (pgErrorInfo(err).constraint === "time_blocks_no_overlap") {
        return { conflicts: [{ date: s.day, reason: "block" }] };
      }
      throw err;
    }
    sessionIds.push(id);
  }
  return { sessionIds };
}
