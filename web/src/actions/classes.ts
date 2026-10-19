"use server";

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { getActorStaffId } from "@/lib/auth/actor-staff";
import { withTenantDb } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { getT } from "@/lib/terms/server";
import { assertModule, hasModule, ModuleDisabledError } from "@/lib/tenant/modules";
import { findRedeemablePackage } from "@/lib/credits/ledger";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { addDays, wallClockToDate } from "@/lib/scheduling/intervals";
import {
  cancelEnrollment,
  cancelSession,
  createClassSessions,
  enrollInClass,
  setSessionCapacity,
  type ClassConflict,
} from "@/lib/classes/enroll";

type Failure = { success: false; error: string };
const fail = (error: string): Failure => ({ success: false, error });

export type ClassSessionRow = {
  id: string;
  serviceId: string;
  className: string;
  staffId: string;
  staffName: string;
  locationId: string | null;
  start: Date;
  end: Date;
  capacity: number;
  waitlistCapacity: number;
  /** Seats taken: booked, plus people already checked in or marked no-show. */
  booked: number;
  waitlisted: number;
  status: "scheduled" | "cancelled" | "completed";
  seriesId: string | null;
  priceCents: number | null;
  /** True when the signed-in person may change this session's roster. */
  canManage: boolean;
};

export type RosterEntry = {
  enrollmentId: string;
  clientId: string;
  name: string;
  status: "booked" | "waitlisted" | "attended" | "no_show";
  waitlistPosition: number | null;
  usesCredit: boolean;
  checkedInAt: Date | null;
};

export type Roster = {
  session: ClassSessionRow;
  /** Booked, checked in and no-show rows. */
  booked: RosterEntry[];
  waitlist: RosterEntry[];
};

type Role = "owner" | "admin" | "provider" | "assistant";
type Guard = Awaited<ReturnType<typeof guard>>;

/** Staff session + module gate. Providers and assistants are limited to their own sessions by `canTouch`. */
async function guard(...roles: Role[]) {
  const auth = await requireRole(...roles);
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = auth.tenantSlug;
  await assertModule(slug, "classes");
  const limited = auth.role === "provider" || auth.role === "assistant";
  const actorStaffId = limited ? await getActorStaffId(slug, auth.userId) : null;
  const t = await getT("classes", slug);
  return { slug, role: auth.role, userId: auth.userId, actorStaffId, limited, t };
}

const canTouch = (g: Guard, sessionStaffId: string) =>
  !g.limited || (g.actorStaffId !== null && sessionStaffId === g.actorStaffId);

/** Turns a thrown module-off error into the sentence the owner should see. */
function asFailure(err: unknown): Failure {
  if (err instanceof ModuleDisabledError) return fail(err.message);
  throw err;
}

const ROSTER_ROLES: Role[] = ["owner", "admin", "provider", "assistant"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

async function loadSessionRows(
  g: Guard,
  where: (t: TenantTables) => SQL | undefined,
): Promise<ClassSessionRow[]> {
  const rows = await withTenantDb(g.slug, async (db, t) => {
    const sessions = await db
      .select({
        id: t.classSessions.id,
        serviceId: t.classSessions.serviceId,
        className: t.services.name,
        staffId: t.classSessions.staffId,
        staffName: t.staff.displayName,
        locationId: t.classSessions.locationId,
        during: t.classSessions.during,
        capacity: t.classSessions.capacity,
        waitlistCapacity: t.classSessions.waitlistCapacity,
        status: t.classSessions.status,
        seriesId: t.classSessions.seriesId,
        priceCents: t.classSessions.priceCents,
      })
      .from(t.classSessions)
      .innerJoin(t.services, eq(t.services.id, t.classSessions.serviceId))
      .innerJoin(t.staff, eq(t.staff.id, t.classSessions.staffId))
      .where(where(t))
      .orderBy(sql`lower(${t.classSessions.during})`);
    if (sessions.length === 0) return { sessions, counts: [] };
    const counts = await db
      .select({
        sessionId: t.classEnrollments.sessionId,
        status: t.classEnrollments.status,
        n: sql<number>`count(*)::int`,
      })
      .from(t.classEnrollments)
      .where(
        and(
          inArray(t.classEnrollments.sessionId, sessions.map((s) => s.id)),
          inArray(t.classEnrollments.status, ["booked", "attended", "no_show", "waitlisted"]),
        ),
      )
      .groupBy(t.classEnrollments.sessionId, t.classEnrollments.status);
    return { sessions, counts };
  });
  return rows.sessions.map((s) => {
    const mine = rows.counts.filter((c) => c.sessionId === s.id);
    return {
      id: s.id,
      serviceId: s.serviceId,
      className: s.className,
      staffId: s.staffId,
      staffName: s.staffName,
      locationId: s.locationId,
      start: s.during.start,
      end: s.during.end,
      capacity: s.capacity,
      waitlistCapacity: s.waitlistCapacity,
      booked: mine.filter((c) => c.status !== "waitlisted").reduce((n, c) => n + Number(c.n), 0),
      waitlisted: mine.filter((c) => c.status === "waitlisted").reduce((n, c) => n + Number(c.n), 0),
      status: s.status as ClassSessionRow["status"],
      seriesId: s.seriesId,
      priceCents: s.priceCents,
      canManage: canTouch(g, s.staffId),
    };
  });
}

/** Every class that starts in the 7 days from `weekStart` (YYYY-MM-DD, the business's local day). */
export async function listClassWeek(weekStart: string): Promise<ClassSessionRow[]> {
  await requireStaff();
  const g = await guard(...ROSTER_ROLES);
  if (!DAY_RE.test(weekStart)) return [];
  const { timezone } = await loadSchedulingSettings(g.slug);
  const from = wallClockToDate(weekStart, "00:00", timezone);
  const to = wallClockToDate(addDays(weekStart, 7), "00:00", timezone);
  return loadSessionRows(g, (t) =>
    and(
      sql`lower(${t.classSessions.during}) >= ${from.toISOString()}::timestamptz`,
      sql`lower(${t.classSessions.during}) < ${to.toISOString()}::timestamptz`,
    ),
  );
}

/** Loads one session for a roster action and applies the "own sessions" rule. */
async function sessionFor(g: Guard, sessionId: string): Promise<ClassSessionRow | Failure> {
  if (!z.uuid().safeParse(sessionId).success) return fail(g.t("errors.notFound"));
  const [row] = await loadSessionRows(g, (t) => eq(t.classSessions.id, sessionId));
  if (!row) return fail(g.t("errors.notFound"));
  if (!row.canManage) return fail(g.t("errors.notYours"));
  return row;
}

/** The session behind an enrollment, with the "own sessions" rule applied. */
async function sessionOfEnrollment(g: Guard, enrollmentId: string): Promise<ClassSessionRow | Failure> {
  if (!z.uuid().safeParse(enrollmentId).success) return fail(g.t("errors.notFound"));
  const [enr] = await withTenantDb(g.slug, async (db, t) =>
    db
      .select({ sessionId: t.classEnrollments.sessionId })
      .from(t.classEnrollments)
      .where(eq(t.classEnrollments.id, enrollmentId))
      .limit(1),
  );
  if (!enr) return fail(g.t("errors.notFound"));
  return sessionFor(g, enr.sessionId);
}

export async function getRoster(sessionId: string): Promise<{ success: true; roster: Roster } | Failure> {
  await requireStaff();
  let g: Guard;
  try {
    g = await guard(...ROSTER_ROLES);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  const session = await sessionFor(g, sessionId);
  if ("success" in session) return session;
  const rows = await withTenantDb(g.slug, async (db, t) =>
    db
      .select({
        enrollmentId: t.classEnrollments.id,
        clientId: t.clients.id,
        name: t.clients.name,
        status: t.classEnrollments.status,
        waitlistPosition: t.classEnrollments.waitlistPosition,
        creditEntryId: t.classEnrollments.creditEntryId,
        checkedInAt: t.classEnrollments.checkedInAt,
      })
      .from(t.classEnrollments)
      .innerJoin(t.clients, eq(t.clients.id, t.classEnrollments.clientId))
      .where(
        and(
          eq(t.classEnrollments.sessionId, sessionId),
          inArray(t.classEnrollments.status, ["booked", "attended", "no_show", "waitlisted"]),
        ),
      )
      .orderBy(asc(t.classEnrollments.waitlistPosition), asc(t.classEnrollments.createdAt)),
  );
  const entries: RosterEntry[] = rows.map((r) => ({
    enrollmentId: r.enrollmentId,
    clientId: r.clientId,
    name: r.name,
    status: r.status as RosterEntry["status"],
    waitlistPosition: r.waitlistPosition,
    usesCredit: r.creditEntryId !== null,
    checkedInAt: r.checkedInAt,
  }));
  return {
    success: true,
    roster: {
      session,
      booked: entries.filter((e) => e.status !== "waitlisted"),
      waitlist: entries
        .filter((e) => e.status === "waitlisted")
        .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0)),
    },
  };
}

export async function addToClass(
  sessionId: string,
  clientId: string,
  useCredit: boolean,
): Promise<{ success: true; status: "booked" | "waitlisted"; position?: number } | Failure> {
  await requireStaff();
  let g: Guard;
  try {
    g = await guard(...ROSTER_ROLES);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  const session = await sessionFor(g, sessionId);
  if ("success" in session) return session;
  if (!z.uuid().safeParse(clientId).success) return fail(g.t("errors.invalid"));
  const res = await enrollInClass(g.slug, { sessionId, clientId, useCredit, actor: "staff" });
  if ("error" in res) return fail(g.t(`public.errors.${res.error}`));
  revalidatePath("/classes");
  revalidatePath(`/classes/${sessionId}`);
  return { success: true, status: res.status, position: res.position };
}

/**
 * Whether the client has a pack credit that this class can use right now.
 * False when the packages module is off, so the screen simply hides the credit choice.
 */
export async function clientClassCredit(
  sessionId: string,
  clientId: string,
): Promise<{ hasCredit: boolean; name: string | null; remaining: number }> {
  await requireStaff();
  const none = { hasCredit: false, name: null, remaining: 0 };
  let g: Guard;
  try {
    g = await guard(...ROSTER_ROLES);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof ModuleDisabledError) return none;
    throw err;
  }
  if (!(await hasModule(g.slug, "packages"))) return none;
  const session = await sessionFor(g, sessionId);
  if ("success" in session || !z.uuid().safeParse(clientId).success) return none;
  const pack = await withTenantDb(g.slug, (db, t) =>
    findRedeemablePackage(db, t, {
      clientId,
      serviceIds: [session.serviceId],
      at: new Date(),
      lock: false,
    }),
  );
  return pack ? { hasCredit: true, name: pack.name, remaining: pack.creditsRemaining } : none;
}

export async function staffCancelEnrollment(
  enrollmentId: string,
  refundCredit: boolean,
): Promise<{ success: true; promotedClientId: string | null } | Failure> {
  await requireStaff();
  let g: Guard;
  try {
    g = await guard(...ROSTER_ROLES);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  const session = await sessionOfEnrollment(g, enrollmentId);
  if ("success" in session) return session;
  const { promotedClientId } = await cancelEnrollment(g.slug, { enrollmentId, actor: "staff", refundCredit });
  revalidatePath("/classes");
  revalidatePath(`/classes/${session.id}`);
  return { success: true, promotedClientId };
}

export async function markAttendance(
  enrollmentId: string,
  outcome: "attended" | "no_show",
): Promise<{ success: true } | Failure> {
  await requireStaff();
  let g: Guard;
  try {
    g = await guard(...ROSTER_ROLES);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  if (outcome !== "attended" && outcome !== "no_show") return fail(g.t("errors.invalid"));
  const session = await sessionOfEnrollment(g, enrollmentId);
  if ("success" in session) return session;
  // Only a booked spot can be marked. A no-show keeps the credit, so the ledger is not touched.
  const now = new Date();
  const updated = await withTenantDb(g.slug, async (db, t) =>
    db
      .update(t.classEnrollments)
      .set({
        status: outcome,
        checkedInAt: outcome === "attended" ? now : null,
        updatedAt: now,
      })
      .where(and(eq(t.classEnrollments.id, enrollmentId), eq(t.classEnrollments.status, "booked")))
      .returning({ id: t.classEnrollments.id }),
  );
  if (updated.length === 0) return fail(g.t("errors.notBooked"));
  revalidatePath(`/classes/${session.id}`);
  return { success: true };
}

export async function updateCapacity(
  sessionId: string,
  capacity: number,
): Promise<{ success: true; promoted: number } | Failure> {
  await requireStaff();
  let g: Guard;
  try {
    g = await guard("owner", "admin");
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  if (!z.uuid().safeParse(sessionId).success) return fail(g.t("errors.notFound"));
  const res = await setSessionCapacity(g.slug, sessionId, capacity);
  if (!res.success) return res;
  revalidatePath("/classes");
  revalidatePath(`/classes/${sessionId}`);
  return res;
}

export async function cancelClass(sessionId: string): Promise<{ success: true; notified: number } | Failure> {
  await requireStaff();
  let g: Guard;
  try {
    g = await guard("owner", "admin");
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  if (!z.uuid().safeParse(sessionId).success) return fail(g.t("errors.notFound"));
  const res = await cancelSession(g.slug, sessionId);
  if (!res.success) return res;
  revalidatePath("/classes");
  revalidatePath(`/classes/${sessionId}`);
  revalidatePath("/schedule");
  return res;
}

const createClassesSchema = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid(),
  locationId: z.uuid().nullable(),
  resourceId: z.uuid().nullable(),
  date: z.string().regex(DAY_RE),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  capacity: z.number().int().min(1).max(500),
  waitlistCapacity: z.number().int().min(0).max(500),
  priceCents: z.number().int().min(0).max(10_000_000).nullable(),
  repeatWeeks: z.union([z.literal(0), z.literal(4), z.literal(8), z.literal(12), z.literal(26)]),
  allowConflicts: z.boolean(),
});
export type CreateClassesInput = z.input<typeof createClassesSchema>;

export async function createClasses(
  input: CreateClassesInput,
): Promise<{ success: true; sessionIds: string[] } | { success: false; conflicts: ClassConflict[] } | Failure> {
  await requireStaff();
  let g: Guard;
  try {
    g = await guard("owner", "admin");
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  const parsed = createClassesSchema.safeParse(input);
  if (!parsed.success) return fail(g.t("errors.invalid"));
  const res = await createClassSessions(g.slug, parsed.data);
  if ("conflicts" in res) return { success: false, conflicts: res.conflicts };
  if ("error" in res) return fail(g.t(res.error === "NOT_FOUND" ? "errors.notFound" : "errors.invalid"));
  revalidatePath("/classes");
  revalidatePath("/schedule");
  return { success: true, sessionIds: res.sessionIds };
}
