import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";

/** Whether a team member is taking new work: always, never, or only inside set dates. */
export type BooksMode = "open" | "windows" | "closed";

export type BooksStaff = { id: string; mode: BooksMode };

/** A date range when requests are welcome. `staffId: null` applies to everyone. */
export type RequestWindow = { staffId: string | null; opensAt: Date; closesAt: Date };

function windowsFor(staffId: string, windows: RequestWindow[]): RequestWindow[] {
  return windows.filter((w) => w.staffId === null || w.staffId === staffId);
}

/** Is this one team member taking requests at `now`? */
export function isStaffOpen(member: BooksStaff, windows: RequestWindow[], now: Date): boolean {
  if (member.mode === "open") return true;
  if (member.mode === "closed") return false;
  const ms = now.getTime();
  return windowsFor(member.id, windows).some(
    (w) => w.opensAt.getTime() <= ms && ms < w.closesAt.getTime(),
  );
}

/** Ids of the team members taking requests at `now`. */
export function openStaffIds(staff: BooksStaff[], windows: RequestWindow[], now: Date): string[] {
  return staff.filter((m) => isStaffOpen(m, windows, now)).map((m) => m.id);
}

/** True when any of `staff` is open. With nobody on the team there is nothing to close. */
export function anyStaffOpen(staff: BooksStaff[], windows: RequestWindow[], now: Date): boolean {
  return staff.length === 0 || staff.some((m) => isStaffOpen(m, windows, now));
}

/** The soonest future start among the request windows of the `windows`-mode members, or null. */
export function earliestOpening(
  staff: BooksStaff[],
  windows: RequestWindow[],
  now: Date,
): Date | null {
  let best: Date | null = null;
  for (const m of staff) {
    if (m.mode !== "windows") continue;
    for (const w of windowsFor(m.id, windows)) {
      if (w.opensAt.getTime() > now.getTime() && (!best || w.opensAt < best)) best = w.opensAt;
    }
  }
  return best;
}

/** Active team members' books plus the request windows that have not ended yet. */
export async function loadBooks(
  slug: string,
  staffId: string | null,
  now: Date,
): Promise<{ staff: BooksStaff[]; windows: RequestWindow[] }> {
  return withTenantDb(slug, async (db, { staff, bookingWindows }) => {
    const rows = await db
      .select({ id: staff.id, mode: staff.booksMode })
      .from(staff)
      .where(and(eq(staff.isActive, 1), staffId ? eq(staff.id, staffId) : undefined));
    const ids = rows.map((r) => r.id);
    const windows =
      ids.length === 0
        ? []
        : await db
            .select({
              staffId: bookingWindows.staffId,
              opensAt: bookingWindows.opensAt,
              closesAt: bookingWindows.closesAt,
            })
            .from(bookingWindows)
            .where(
              and(
                eq(bookingWindows.mode, "requests"),
                gt(bookingWindows.closesAt, now),
                or(isNull(bookingWindows.staffId), inArray(bookingWindows.staffId, ids)),
              ),
            );
    return { staff: rows.map((r) => ({ id: r.id, mode: r.mode as BooksMode })), windows };
  });
}

/**
 * Are requests open? For one team member, or (null) for anyone. A staff id that is not an
 * active team member counts as open here; the caller's own checks reject it.
 */
export async function requestsOpen(
  slug: string,
  staffId: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  const { staff, windows } = await loadBooks(slug, staffId, now);
  if (staffId && staff.length === 0) return true;
  return anyStaffOpen(staff, windows, now);
}

/** When requests next open (the earliest future request window), or null if nothing is scheduled. */
export async function nextOpening(
  slug: string,
  staffId: string | null,
  now: Date = new Date(),
): Promise<Date | null> {
  const { staff, windows } = await loadBooks(slug, staffId, now);
  return earliestOpening(staff, windows, now);
}
