/**
 * Calendar provider factory.
 * Returns the Google Calendar implementation and token refresh for the platform.
 */

import type { CalendarProvider, TokenResponse } from "./types";
import { googleCalendarProvider, GoogleOAuthError, refreshGoogleToken } from "./google";
import { withTenantDb } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";

const LEGACY_OUTLOOK =
  "Outlook calendar is no longer supported. Disconnect this connection and connect Google Calendar.";

const TRANSIENT_FAILURE_THRESHOLD = 3;

const MSG_PERMANENT =
  "Google Calendar access expired or was revoked. Reconnect in Settings → Calendars.";
const MSG_TRANSIENT_ESCALATED =
  "Google Calendar connection failed after several attempts. Reconnect in Settings → Calendars.";
const calendarConnectionsTag = (tenantSlug: string) =>
  `tenant:${tenantSlug}:calendar-connections`;

function isPermanentOAuthError(code?: string): boolean {
  return code === "invalid_grant" || code === "invalid_client";
}

export function getCalendarProvider(platform: string): CalendarProvider {
  if (platform === "microsoft_calendar") {
    throw new Error(LEGACY_OUTLOOK);
  }
  if (platform !== "google_calendar") {
    throw new Error(`Unsupported calendar platform: ${platform}`);
  }
  return googleCalendarProvider;
}

export async function refreshTokenForPlatform(
  platform: string,
  refreshToken: string,
): Promise<TokenResponse> {
  if (platform === "microsoft_calendar") {
    throw new Error(LEGACY_OUTLOOK);
  }
  if (platform !== "google_calendar") {
    throw new Error(`Unsupported calendar platform: ${platform}`);
  }
  return refreshGoogleToken(refreshToken);
}

/**
 * Calendar row fields required for token refresh and failure handling.
 */
export type CalendarConnectionTokenInput = {
  id: string;
  staffId: string;
  platform: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  status: string;
  errorCount?: number | null;
};

/**
 * Get a valid access token for a calendar connection, refreshing if expired.
 * Persists new tokens to the database on refresh.
 */
export async function getValidAccessToken(
  connection: CalendarConnectionTokenInput,
  tenantSlug: string,
): Promise<string> {
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minute buffer before expiry
  const prevErrorCount = connection.errorCount ?? 0;

  if (connection.tokenExpiresAt.getTime() - bufferMs > now.getTime()) {
    return connection.accessToken;
  }

  // Token expired or about to expire -- refresh
  try {
    const newTokens = await refreshTokenForPlatform(
      connection.platform,
      connection.refreshToken,
    );

    // Persist new tokens
    await withTenantDb(tenantSlug, async (db, { calendarConnections }) => {
      await db
        .update(calendarConnections)
        .set({
          accessToken: newTokens.access_token,
          // Google doesn't always return a new refresh token on refresh
          ...(newTokens.refresh_token
            ? { refreshToken: newTokens.refresh_token }
            : {}),
          tokenExpiresAt: new Date(
            Date.now() + newTokens.expires_in * 1000,
          ),
          status: "active",
          errorMessage: null,
          errorCount: 0,
          updatedAt: new Date(),
        })
        .where(eq(calendarConnections.id, connection.id));
    });
    revalidateTag(calendarConnectionsTag(tenantSlug), { expire: 0 });

    return newTokens.access_token;
  } catch (error) {
    const oauthCode =
      error instanceof GoogleOAuthError ? error.oauthError : undefined;
    const permanent = isPermanentOAuthError(oauthCode);
    const newFailCount = prevErrorCount + 1;
    const escalate =
      permanent || newFailCount >= TRANSIENT_FAILURE_THRESHOLD;

    const friendlyMessage = permanent
      ? MSG_PERMANENT
      : newFailCount >= TRANSIENT_FAILURE_THRESHOLD
        ? MSG_TRANSIENT_ESCALATED
        : null;

    await withTenantDb(tenantSlug, async (db, { calendarConnections }) => {
      if (escalate) {
        await db
          .update(calendarConnections)
          .set({
            status: "error",
            errorMessage: friendlyMessage,
            errorCount: 0,
            updatedAt: new Date(),
          })
          .where(eq(calendarConnections.id, connection.id));
      } else {
        await db
          .update(calendarConnections)
          .set({
            errorCount: newFailCount,
            updatedAt: new Date(),
          })
          .where(eq(calendarConnections.id, connection.id));
      }
    });
    if (escalate) {
      revalidateTag(calendarConnectionsTag(tenantSlug), { expire: 0 });
    }

    if (escalate && connection.status === "active") {
      const { notifyCalendarConnectionError } = await import(
        "@/lib/calendar/notify-calendar-disconnect"
      );
      await notifyCalendarConnectionError({
        tenantSlug,
        staffId: connection.staffId,
        platform: connection.platform,
      });
    }

    throw error;
  }
}
