import { withTenantDb } from "@/lib/db/tenant";
import { eq, and } from "drizzle-orm";
import { unstable_cache } from "next/cache";

const CALENDAR_CONNECTIONS_CACHE_TTL_SECONDS = 60;

export function calendarConnectionsTag(tenantSlug: string): string {
  return `tenant:${tenantSlug}:calendar-connections`;
}

export async function listAllBrokenCalendarConnectionsForTenant(
  tenantSlug: string,
): Promise<Array<{ staffName: string; platform: string }>> {
  return unstable_cache(
    async () =>
      withTenantDb(tenantSlug, async (db, { calendarConnections, staff }) => {
        return db
          .select({
            staffName: staff.displayName,
            platform: calendarConnections.platform,
          })
          .from(calendarConnections)
          .innerJoin(staff, eq(calendarConnections.staffId, staff.id))
          .where(eq(calendarConnections.status, "error"));
      }),
    ["tenant-broken-calendar-connections", tenantSlug],
    {
      revalidate: CALENDAR_CONNECTIONS_CACHE_TTL_SECONDS,
      tags: [calendarConnectionsTag(tenantSlug)],
    },
  )();
}

export async function getActiveConnectionForStaffInTenant(
  tenantSlug: string,
  staffId: string,
) {
  const [connection] = await withTenantDb(
    tenantSlug,
    async (db, { calendarConnections }) => {
      return db
        .select()
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.staffId, staffId),
            eq(calendarConnections.status, "active"),
          ),
        )
        .limit(1);
    },
  );

  return connection ?? null;
}
