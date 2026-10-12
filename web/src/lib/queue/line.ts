/**
 * The walk-in line's state changes: call, start and finish. Server-only and
 * free of sessions and copy, so the server actions stay thin and the database
 * tests can pass a fixed `now`.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { bookAppointment } from "@/lib/booking/book";
import { createClientForTenant } from "@/lib/clients/for-tenant";

export type ClaimedEntry = {
  id: string;
  name: string;
  phone: string | null;
  clientId: string | null;
  assignedStaffId: string;
  assignedStaffName: string;
};

export type ClaimResult =
  | { status: "ok"; entry: ClaimedEntry }
  | { status: "empty"; staffName: string }
  | { status: "no_service"; staffName: string }
  | { status: "stale"; staffName: string };

/**
 * Calls one waiting person for one staff member. The row is locked with
 * `FOR UPDATE SKIP LOCKED` inside the transaction, so two people calling at the
 * same moment never take the same row.
 *
 * - `entryId` set: call that exact person (they must be waiting, and the staff
 *   member must offer their service).
 * - `entryId` null: the first person in join order this staff member can take.
 */
export async function claimEntry(
  slug: string,
  p: { staffId: string; locationId: string | null; entryId: string | null },
  now: Date = new Date(),
): Promise<ClaimResult> {
  return withTenantDb(slug, async (db, t) =>
    db.transaction(async (tx): Promise<ClaimResult> => {
      const [person] = await tx
        .select({ name: t.staff.displayName })
        .from(t.staff)
        .where(eq(t.staff.id, p.staffId))
        .limit(1);
      const staffName = person?.name ?? "";

      const offered = tx
        .select({ id: t.staffServices.serviceId })
        .from(t.staffServices)
        .where(and(eq(t.staffServices.staffId, p.staffId), eq(t.staffServices.isOffered, 1)));

      const conditions = [
        eq(t.queueEntries.status, "waiting"),
        p.locationId ? eq(t.queueEntries.locationId, p.locationId) : undefined,
      ];
      if (p.entryId) {
        conditions.push(eq(t.queueEntries.id, p.entryId));
      } else {
        conditions.push(
          or(isNull(t.queueEntries.preferredStaffId), eq(t.queueEntries.preferredStaffId, p.staffId)),
          or(isNull(t.queueEntries.serviceId), inArray(t.queueEntries.serviceId, offered)),
        );
      }

      const [row] = await tx
        .select({
          id: t.queueEntries.id,
          name: t.queueEntries.name,
          phone: t.queueEntries.phone,
          clientId: t.queueEntries.clientId,
          serviceId: t.queueEntries.serviceId,
        })
        .from(t.queueEntries)
        .where(and(...conditions))
        .orderBy(asc(t.queueEntries.joinedAt), asc(t.queueEntries.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return { status: p.entryId ? "stale" : "empty", staffName };

      if (p.entryId && row.serviceId) {
        const [ok] = await tx
          .select({ id: t.staffServices.id })
          .from(t.staffServices)
          .where(
            and(
              eq(t.staffServices.staffId, p.staffId),
              eq(t.staffServices.serviceId, row.serviceId),
              eq(t.staffServices.isOffered, 1),
            ),
          )
          .limit(1);
        if (!ok) return { status: "no_service", staffName };
      }

      await tx
        .update(t.queueEntries)
        .set({ status: "called", assignedStaffId: p.staffId, calledAt: now, updatedAt: now })
        .where(eq(t.queueEntries.id, row.id));
      return {
        status: "ok",
        entry: {
          id: row.id,
          name: row.name,
          phone: row.phone,
          clientId: row.clientId,
          assignedStaffId: p.staffId,
          assignedStaffName: staffName,
        },
      };
    }),
  );
}

export type StartResult =
  | { status: "ok"; appointmentId: string }
  | { status: "stale" }
  | { status: "need_service" }
  | { status: "busy"; staffName: string };

/** The start of the current minute. */
export function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

/**
 * Starts a called person: books a real appointment for their staff member from
 * this minute (override mode, so the line never fights the calendar), then
 * marks the entry as being served.
 */
export async function beginService(
  slug: string,
  p: { entryId: string; serviceId: string | null },
  now: Date = new Date(),
): Promise<StartResult> {
  const found = await withTenantDb(slug, async (db, t) => {
    const [entry] = await db
      .select({
        id: t.queueEntries.id,
        name: t.queueEntries.name,
        phone: t.queueEntries.phone,
        status: t.queueEntries.status,
        clientId: t.queueEntries.clientId,
        serviceId: t.queueEntries.serviceId,
        locationId: t.queueEntries.locationId,
        staffId: t.queueEntries.assignedStaffId,
        staffName: t.staff.displayName,
      })
      .from(t.queueEntries)
      .leftJoin(t.staff, eq(t.staff.id, t.queueEntries.assignedStaffId))
      .where(eq(t.queueEntries.id, p.entryId))
      .limit(1);
    return entry;
  });
  if (!found || found.status !== "called" || !found.staffId) return { status: "stale" };
  const serviceId = found.serviceId ?? p.serviceId;
  if (!serviceId) return { status: "need_service" };
  const staffName = found.staffName ?? "";

  // The appointment needs a client; walk-ins added without a phone have none yet.
  let clientId = found.clientId;
  if (!clientId) {
    const created = await createClientForTenant(slug, { name: found.name, phone: found.phone });
    if (!created.success) return { status: "busy", staffName };
    clientId = created.id;
  }

  const res = await bookAppointment({
    slug,
    staffId: found.staffId,
    clientId,
    serviceIds: [serviceId],
    start: floorToMinute(now),
    locationId: found.locationId,
    mode: "override",
    now,
  });
  if (!res.ok) return { status: "busy", staffName };

  const claimed = await withTenantDb(slug, async (db, t) =>
    db
      .update(t.queueEntries)
      .set({
        status: "in_service",
        appointmentId: res.id,
        serviceId,
        clientId,
        startedAt: now,
        updatedAt: now,
      })
      .where(and(eq(t.queueEntries.id, p.entryId), eq(t.queueEntries.status, "called")))
      .returning({ id: t.queueEntries.id }),
  );
  if (claimed.length === 0) return { status: "stale" };
  return { status: "ok", appointmentId: res.id };
}

/**
 * Finishes a person who is being served and trims their appointment to end now
 * (never shorter than 5 minutes), including the rooms and chairs it held, so
 * the calendar frees up. Returns the appointment id, or null when the entry was
 * not in service.
 */
export async function endService(
  slug: string,
  entryId: string,
  now: Date = new Date(),
): Promise<{ appointmentId: string | null } | null> {
  return withTenantDb(slug, async (db, t) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(t.queueEntries)
        .set({ status: "done", doneAt: now, updatedAt: now })
        .where(and(eq(t.queueEntries.id, entryId), eq(t.queueEntries.status, "in_service")))
        .returning({ appointmentId: t.queueEntries.appointmentId });
      if (!row) return null;
      if (row.appointmentId) {
        const nowSql = sql`${now.toISOString()}::timestamptz`;
        await tx
          .update(t.appointments)
          .set({
            during: sql`tstzrange(lower(${t.appointments.during}), greatest(lower(${t.appointments.during}) + interval '5 minutes', ${nowSql}), '[)')`,
          })
          .where(and(eq(t.appointments.id, row.appointmentId), sql`upper(${t.appointments.during}) > ${nowSql}`));
        await tx.execute(
          sql`UPDATE ${t.appointmentResources} AS r
              SET during = tstzrange(lower(r.during), upper(a.during), '[)')
              FROM ${t.appointments} AS a
              WHERE a.id = r.appointment_id
                AND r.appointment_id = ${row.appointmentId}
                AND upper(r.during) > upper(a.during)`,
        );
      }
      return { appointmentId: row.appointmentId };
    }),
  );
}
