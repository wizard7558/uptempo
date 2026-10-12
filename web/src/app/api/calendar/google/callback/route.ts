import { NextResponse } from "next/server";
import { validateOAuthState } from "@/lib/calendar/oauth";
import { exchangeGoogleCode, getGoogleUserInfo } from "@/lib/calendar/google";
import { googleCalendarProvider } from "@/lib/calendar/google";
import { saveCalendarConnection } from "@/actions/calendar-connections";
import { syncExternalEventsForConnection } from "@/lib/calendar/sync-tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { getBaseUrl } from "@/lib/utils";
import { buildNativeReturnUrl, type NativeApp } from "@/lib/native/return";

export const dynamic = "force-dynamic";

/**
 * Build the post-callback redirect. When the flow was started from a native
 * app, return to the app via its custom URL scheme; otherwise use the normal
 * web settings page.
 */
function calendarRedirect(
  req: Request,
  native: NativeApp | undefined,
  params: Record<string, string | undefined>,
): NextResponse {
  if (native) {
    return NextResponse.redirect(
      buildNativeReturnUrl(native, "calendar-callback", params),
    );
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") qs.set(k, v);
  }
  return NextResponse.redirect(
    new URL(`/settings/calendars?${qs.toString()}`, req.url),
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // `state` is validated below; decode native marker early for error redirects.
  const earlyState = state ? validateOAuthState(state) : null;
  const native = earlyState?.native;

  if (error) {
    return calendarRedirect(req, native, { error });
  }

  if (!code || !state) {
    return calendarRedirect(req, native, { error: "missing_params" });
  }

  const stateData = earlyState;
  if (!stateData || stateData.platform !== "google_calendar") {
    return calendarRedirect(req, native, { error: "invalid_state" });
  }

  try {
    const redirectUri = `${getBaseUrl()}/api/calendar/google/callback`;
    const tokenData = await exchangeGoogleCode(code, redirectUri);

    // Get user info
    const userInfo = await getGoogleUserInfo(tokenData.access_token);

    // List calendars and pick the primary one
    const calendars = await googleCalendarProvider.listCalendars(
      tokenData.access_token,
    );
    const primary = calendars.find((c) => c.primary) || calendars[0];

    const connection = await saveCalendarConnection({
      staffId: stateData.staffId,
      platform: "google_calendar",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || "",
      expiresIn: tokenData.expires_in,
      platformUserId: userInfo.id,
      platformEmail: userInfo.email,
      calendarId: primary?.id || "primary",
    });

    // Trigger initial sync (fire-and-forget)
    const slug = await getTenantSlug();
    syncExternalEventsForConnection(slug, connection.id).catch((err) => {
      console.error("Initial calendar sync failed:", err);
    });

    return calendarRedirect(req, native, {
      connected: connection.id,
      platform: "google_calendar",
    });
  } catch (err) {
    console.error("Google Calendar OAuth callback error:", err);
    return calendarRedirect(req, native, { error: "connection_failed" });
  }
}
