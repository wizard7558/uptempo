import { and, eq, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";

/** How far ahead the public schedule looks. */
export const PUBLIC_CLASS_DAYS = 14;

/** The start and end of the public schedule window, measured from `now`. */
export function publicClassWindow(now: Date = new Date()): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + PUBLIC_CLASS_DAYS * 86_400_000) };
}

/** True when at least one scheduled class starts inside the public window. */
export async function hasUpcomingClasses(slug: string): Promise<boolean> {
  const { from, to } = publicClassWindow();
  const rows = await withTenantDb(slug, async (db, t) =>
    db
      .select({ id: t.classSessions.id })
      .from(t.classSessions)
      .where(
        and(
          eq(t.classSessions.status, "scheduled"),
          sql`lower(${t.classSessions.during}) > ${from.toISOString()}::timestamptz`,
          sql`lower(${t.classSessions.during}) < ${to.toISOString()}::timestamptz`,
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}
