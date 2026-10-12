"use server";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { hasModule } from "@/lib/tenant/modules";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { findRedeemablePackage } from "@/lib/credits/ledger";
import { isOnTimeCancel } from "@/lib/credits/cancel";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { publicClassWindow } from "@/lib/classes/public";
import { cancelEnrollment, enrollInClass, type EnrollResult } from "@/lib/classes/enroll";
import { getAgeGateForServices } from "@/actions/booking-public";

/**
 * The public class flow. Every action here is gated on the classes module, and every
 * write acts as the signed-in booking client (never as staff).
 */

const DEFAULT_WINDOW_HOURS = 24;

export type PublicClass = {
  id: string;
  className: string;
  /** First name only: this page is public. */
  staffFirstName: string;
  /** ISO instants. */
  start: string;
  end: string;
  spotsLeft: number;
  /** True when the class is full but the waitlist still has room. */
  waitlistOpen: boolean;
  /** Null when the business set no price. */
  priceCents: number | null;
};

export type PublicClassList = { timezone: string; classes: PublicClass[] };

export type MyClassSpot = {
  enrollmentId: string;
  className: string;
  start: string;
  end: string;
  status: "booked" | "waitlisted";
  waitlistPosition: number | null;
  usesCredit: boolean;
  /** Inside the cancellation window, so a cancel now keeps the credit. */
  isLate: boolean;
  windowHours: number;
};

const firstName = (displayName: string) => displayName.trim().split(/\s+/)[0] ?? displayName;

/** The next 14 days of scheduled classes, soonest first. Empty when the module is off. */
export async function listPublicClasses(): Promise<PublicClassList> {
  const slug = await getTenantSlug();
  const { timezone } = await loadSchedulingSettings(slug);
  if (!(await hasModule(slug, "classes"))) return { timezone, classes: [] };
  const { from, to } = publicClassWindow();
  const classes = await withTenantDb(slug, async (db, t) => {
    const sessions = await db
      .select({
        id: t.classSessions.id,
        className: t.services.name,
        staffName: t.staff.displayName,
        during: t.classSessions.during,
        capacity: t.classSessions.capacity,
        waitlistCapacity: t.classSessions.waitlistCapacity,
        sessionPrice: t.classSessions.priceCents,
        servicePrice: t.services.priceCents,
      })
      .from(t.classSessions)
      .innerJoin(t.services, eq(t.services.id, t.classSessions.serviceId))
      .innerJoin(t.staff, eq(t.staff.id, t.classSessions.staffId))
      .where(
        and(
          eq(t.classSessions.status, "scheduled"),
          sql`lower(${t.classSessions.during}) > ${from.toISOString()}::timestamptz`,
          sql`lower(${t.classSessions.during}) < ${to.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(asc(sql`lower(${t.classSessions.during})`));
    if (sessions.length === 0) return [];
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
    return sessions.map((s): PublicClass => {
      const mine = counts.filter((c) => c.sessionId === s.id);
      const taken = mine.filter((c) => c.status !== "waitlisted").reduce((n, c) => n + Number(c.n), 0);
      const waiting = mine.filter((c) => c.status === "waitlisted").reduce((n, c) => n + Number(c.n), 0);
      const spotsLeft = Math.max(0, s.capacity - taken);
      return {
        id: s.id,
        className: s.className,
        staffFirstName: firstName(s.staffName),
        start: s.during.start.toISOString(),
        end: s.during.end.toISOString(),
        spotsLeft,
        waitlistOpen: spotsLeft === 0 && waiting < s.waitlistCapacity,
        priceCents: s.sessionPrice ?? s.servicePrice ?? null,
      };
    });
  });
  return { timezone, classes };
}

/** The service behind a scheduled, future class, or null. */
async function classServiceId(slug: string, sessionId: string): Promise<string | null> {
  if (!z.string().uuid().safeParse(sessionId).success) return null;
  const [row] = await withTenantDb(slug, async (db, t) =>
    db
      .select({ serviceId: t.classSessions.serviceId })
      .from(t.classSessions)
      .where(eq(t.classSessions.id, sessionId))
      .limit(1),
  );
  return row?.serviceId ?? null;
}

/**
 * The credit the signed-in client could spend on this class, or null.
 * Powers "Use 1 credit from {name} ({remaining} left)".
 */
export async function getClassCreditOption(
  sessionId: string,
): Promise<{ name: string; remaining: number } | null> {
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, "classes")) || !(await hasModule(slug, "packages"))) return null;
  const clientId = await getBookingSession();
  if (!clientId) return null;
  const serviceId = await classServiceId(slug, sessionId);
  if (!serviceId) return null;
  return withTenantDb(slug, async (db, tables) => {
    const pkg = await findRedeemablePackage(db, tables, {
      clientId,
      serviceIds: [serviceId],
      at: new Date(),
      lock: false,
    });
    return pkg ? { name: pkg.name, remaining: pkg.creditsRemaining } : null;
  });
}

/**
 * The minimum age for this class when the client still has to type a birthday, else null.
 * (Same rule as the booking confirm step.)
 */
export async function getClassAgeGate(sessionId: string): Promise<{ minAge: number } | null> {
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, "classes"))) return null;
  const serviceId = await classServiceId(slug, sessionId);
  if (!serviceId) return null;
  const res = await getAgeGateForServices([serviceId]);
  return res.gate && !res.birthdayKnown ? { minAge: res.gate.minAge } : null;
}

export type BookClassSpotResult = EnrollResult | { error: "NOT_SIGNED_IN" };

/** Takes a spot (or a waitlist place) for the signed-in client. */
export async function bookClassSpot(
  sessionId: string,
  useCredit: boolean,
  dob?: string,
): Promise<BookClassSpotResult> {
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, "classes"))) return { error: "CLOSED" };
  if (!z.string().uuid().safeParse(sessionId).success) return { error: "CLOSED" };
  const clientId = await getBookingSession();
  if (!clientId) return { error: "NOT_SIGNED_IN" };
  return enrollInClass(slug, {
    sessionId,
    clientId,
    useCredit: useCredit === true,
    actor: "client",
    dob: dob ?? null,
  });
}

/** Cancels one of the signed-in client's own spots. A late cancel keeps the credit. */
export async function cancelMyClassSpot(
  enrollmentId: string,
): Promise<{ success: true } | { success: false; error: "NOT_SIGNED_IN" | "CLOSED" }> {
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, "classes"))) return { success: false, error: "CLOSED" };
  const clientId = await getBookingSession();
  if (!clientId) return { success: false, error: "NOT_SIGNED_IN" };
  if (!z.string().uuid().safeParse(enrollmentId).success) return { success: false, error: "CLOSED" };
  const [own] = await withTenantDb(slug, async (db, t) =>
    db
      .select({ id: t.classEnrollments.id })
      .from(t.classEnrollments)
      .where(and(eq(t.classEnrollments.id, enrollmentId), eq(t.classEnrollments.clientId, clientId)))
      .limit(1),
  );
  if (!own) return { success: false, error: "CLOSED" };
  await cancelEnrollment(slug, { enrollmentId, actor: "client" });
  return { success: true };
}

/** The signed-in client's upcoming booked and waitlisted spots. */
export async function myClassSpots(): Promise<MyClassSpot[]> {
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, "classes"))) return [];
  const clientId = await getBookingSession();
  if (!clientId) return [];
  const rows = await withTenantDb(slug, async (db, t) => {
    const [settings] = await db
      .select({ hours: t.businessSettings.cancellationWindowHours })
      .from(t.businessSettings)
      .limit(1);
    const spots = await db
      .select({
        enrollmentId: t.classEnrollments.id,
        status: t.classEnrollments.status,
        waitlistPosition: t.classEnrollments.waitlistPosition,
        creditEntryId: t.classEnrollments.creditEntryId,
        className: t.services.name,
        during: t.classSessions.during,
      })
      .from(t.classEnrollments)
      .innerJoin(t.classSessions, eq(t.classSessions.id, t.classEnrollments.sessionId))
      .innerJoin(t.services, eq(t.services.id, t.classSessions.serviceId))
      .where(
        and(
          eq(t.classEnrollments.clientId, clientId),
          inArray(t.classEnrollments.status, ["booked", "waitlisted"]),
          eq(t.classSessions.status, "scheduled"),
          sql`lower(${t.classSessions.during}) > now()`,
        ),
      )
      .orderBy(asc(sql`lower(${t.classSessions.during})`));
    return { hours: settings?.hours ?? DEFAULT_WINDOW_HOURS, spots };
  });
  const now = new Date();
  return rows.spots.map((s): MyClassSpot => ({
    enrollmentId: s.enrollmentId,
    className: s.className,
    start: s.during.start.toISOString(),
    end: s.during.end.toISOString(),
    status: s.status as "booked" | "waitlisted",
    waitlistPosition: s.waitlistPosition,
    usesCredit: s.creditEntryId !== null,
    isLate: s.status === "booked" && !isOnTimeCancel(s.during.start, now, rows.hours),
    windowHours: rows.hours,
  }));
}
