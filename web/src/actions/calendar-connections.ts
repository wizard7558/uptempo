"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { withTenantDb } from "@/lib/db/tenant";
import { generateOAuthState } from "@/lib/calendar/oauth";
import { getGoogleCalendarAuthUrl } from "@/lib/calendar/google";
import {
  getCalendarProvider,
  getValidAccessToken,
} from "@/lib/calendar/provider";
import type { CalendarPlatform, CalendarInfo } from "@/lib/calendar/types";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import { getBaseUrl } from "@/lib/utils";
import { calendarConnectionsTag, getActiveConnectionForStaffInTenant } from "@/lib/calendar/tenant-connections";

/** Build the OAuth authorization URL for Google Calendar */
export async function getCalendarAuthUrl(
  staffId: string,
  platform: CalendarPlatform,
  native?: "owner" | "client",
): Promise<string> {
  await requireStaff();
  if (platform !== "google_calendar") {
    throw new Error("Only Google Calendar is supported");
  }
  const state = generateOAuthState(staffId, platform, native);
  const baseUrl = getBaseUrl();
  const redirectUri = `${baseUrl}/api/calendar/google/callback`;
  return getGoogleCalendarAuthUrl(state, redirectUri);
}

/** Store a new calendar connection after OAuth callback */
export async function saveCalendarConnection(data: {
  staffId: string;
  platform: CalendarPlatform;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  platformUserId: string;
  platformEmail: string;
  calendarId: string;
}) {
  const { tenantSlug: slug } = await requireStaff();

  const connection = await withTenantDb(
    slug,
    async (db, { calendarConnections }) => {
      // Delete any existing connection for this staff member and platform (upsert)
      await db
        .delete(calendarConnections)
        .where(
          and(
            eq(calendarConnections.staffId, data.staffId),
            eq(calendarConnections.platform, data.platform),
          ),
        );

      const [conn] = await db
        .insert(calendarConnections)
        .values({
          staffId: data.staffId,
          platform: data.platform,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          tokenExpiresAt: new Date(Date.now() + data.expiresIn * 1000),
          platformUserId: data.platformUserId,
          platformEmail: data.platformEmail,
          calendarId: data.calendarId,
          status: "active",
          errorCount: 0,
        })
        .returning();
      return conn;
    },
  );

  trackEvent(
    "calendar.connected",
    { platform: data.platform },
    { tenantSlug: slug },
  );
  revalidateTag(calendarConnectionsTag(slug));
  return connection;
}

/** Disconnect a calendar connection */
export async function disconnectCalendar(connectionId: string) {
  const { tenantSlug: slug } = await requireStaff();

  // Delete associated external events and the connection
  await withTenantDb(slug, async (db, { externalEvents, calendarConnections }) => {
    await db
      .delete(externalEvents)
      .where(eq(externalEvents.connectionId, connectionId));

    await db
      .delete(calendarConnections)
      .where(eq(calendarConnections.id, connectionId));
  });

  revalidatePath("/settings/calendars");
  revalidateTag(calendarConnectionsTag(slug));
  trackEvent("calendar.disconnected", {}, { tenantSlug: slug });
  return { success: true as const };
}

/** Get all calendar connections for a staff member */
export async function getCalendarConnections(staffId: string) {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { calendarConnections }) => {
    const connections = await db
      .select({
        id: calendarConnections.id,
        platform: calendarConnections.platform,
        platformEmail: calendarConnections.platformEmail,
        calendarId: calendarConnections.calendarId,
        status: calendarConnections.status,
        errorMessage: calendarConnections.errorMessage,
        lastSyncedAt: calendarConnections.lastSyncedAt,
      })
      .from(calendarConnections)
      .where(eq(calendarConnections.staffId, staffId));

    return connections;
  });
}

export async function listBrokenCalendarConnections(staffIds: string[]) {
  const { tenantSlug: slug } = await requireStaff();
  if (staffIds.length === 0) {
    return [] as Array<{ staffName: string; platform: string }>;
  }


  return withTenantDb(slug, async (db, { calendarConnections, staff }) => {
    return db
      .select({
        staffName: staff.displayName,
        platform: calendarConnections.platform,
      })
      .from(calendarConnections)
      .innerJoin(staff, eq(calendarConnections.staffId, staff.id))
      .where(
        and(
          eq(calendarConnections.status, "error"),
          inArray(calendarConnections.staffId, staffIds),
        ),
      );
  });
}

/** Update the selected calendar ID for a connection (push target) */
export async function setCalendarId(
  connectionId: string,
  calendarId: string,
) {
  const { tenantSlug: slug } = await requireStaff();
  await withTenantDb(slug, async (db, { calendarConnections }) => {
    await db
      .update(calendarConnections)
      .set({ calendarId, updatedAt: new Date() })
      .where(eq(calendarConnections.id, connectionId));
  });

  revalidatePath("/settings/calendars");
  revalidateTag(calendarConnectionsTag(slug));
  return { success: true as const };
}

/** List writable calendars for a connection */
export async function listCalendarsForConnection(
  connectionId: string,
): Promise<CalendarInfo[]> {
  const { tenantSlug: slug } = await requireStaff();

  const [connection] = await withTenantDb(
    slug,
    async (db, { calendarConnections }) => {
      return db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId))
        .limit(1);
    },
  );

  if (!connection) return [];

  const accessToken = await getValidAccessToken(connection, slug);
  const provider = getCalendarProvider(connection.platform);
  const calendars = await provider.listCalendars(accessToken);

  // Only return writable calendars
  return calendars.filter((c) => c.accessRole === "writer" || c.accessRole === "owner");
}

/** Get active calendar connection for a staff member (for push/sync operations) */
export async function getActiveConnectionForStaffMember(staffId: string) {
  const { tenantSlug: slug } = await requireStaff();
  return getActiveConnectionForStaffInTenant(slug, staffId);
}
