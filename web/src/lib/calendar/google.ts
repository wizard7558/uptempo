/**
 * Google Calendar API v3 provider.
 * Uses raw fetch -- no SDK dependency.
 *
 * Docs: https://developers.google.com/calendar/api/v3/reference
 */

import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEvent,
  CreateEventInput,
  FreeBusySlot,
  TokenResponse,
  PlatformUserInfo,
} from "./types";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Thrown when Google OAuth token endpoint returns an error; includes `error` field from JSON body when present. */
export class GoogleOAuthError extends Error {
  readonly oauthError?: string;

  constructor(message: string, oauthError?: string) {
    super(message);
    this.name = "GoogleOAuthError";
    this.oauthError = oauthError;
  }
}

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "openid",
  "email",
];

export function getGoogleCalendarAuthUrl(
  state: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    const code = typeof error.error === "string" ? error.error : undefined;
    throw new GoogleOAuthError(
      `Google token exchange failed: ${error.error_description || error.error}`,
      code,
    );
  }

  return response.json();
}

export async function refreshGoogleToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    const code = typeof error.error === "string" ? error.error : undefined;
    throw new GoogleOAuthError(
      `Google token refresh failed: ${error.error_description || error.error}`,
      code,
    );
  }

  return response.json();
}

export async function getGoogleUserInfo(
  accessToken: string,
): Promise<PlatformUserInfo> {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    throw new Error("Failed to get Google user info");
  }

  const data = await response.json();
  return { id: data.sub, email: data.email };
}

async function googleFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: { message: response.statusText } }));
    throw new Error(
      `Google Calendar API error: ${error.error?.message || response.statusText}`,
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Google Calendar API responses are untyped
type GCalResponse = any;

export const googleCalendarProvider: CalendarProvider = {
  async listCalendars(accessToken: string): Promise<CalendarInfo[]> {
    const data = await googleFetch(accessToken, "/users/me/calendarList");
    return (data.items || []).map((cal: GCalResponse) => ({
      id: cal.id,
      name: cal.summary,
      primary: cal.primary || false,
      accessRole: cal.accessRole,
    }));
  },

  async listEvents(
    accessToken: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });

    const data = await googleFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    );

    return (data.items || []).map((event: GCalResponse) => ({
      id: event.id,
      title: event.summary || "(No title)",
      description: event.description,
      startTime: new Date(event.start.dateTime || event.start.date),
      endTime: new Date(event.end.dateTime || event.end.date),
      timezone: event.start.timeZone || "UTC",
      attendees: event.attendees?.map((a: GCalResponse) => ({
        email: a.email,
        name: a.displayName,
        responseStatus: a.responseStatus,
      })),
      location: event.location,
      htmlLink: event.htmlLink,
    }));
  },

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: CreateEventInput,
  ): Promise<CalendarEvent> {
    const body = {
      summary: event.title,
      description: event.description,
      start: {
        dateTime: event.startTime.toISOString(),
        timeZone: event.timezone,
      },
      end: { dateTime: event.endTime.toISOString(), timeZone: event.timezone },
      attendees: event.attendees?.map((a) => ({
        email: a.email,
        displayName: a.name,
      })),
      location: event.location,
    };

    const data = await googleFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      { method: "POST", body: JSON.stringify(body) },
    );

    return {
      id: data.id,
      title: data.summary,
      description: data.description,
      startTime: new Date(data.start.dateTime || data.start.date),
      endTime: new Date(data.end.dateTime || data.end.date),
      timezone: data.start.timeZone || event.timezone,
      htmlLink: data.htmlLink,
    };
  },

  async deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<void> {
    await googleFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  },

  async getFreeBusy(
    accessToken: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<FreeBusySlot[]> {
    const body = {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: calendarId }],
    };

    const data = await googleFetch(accessToken, "/freeBusy", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const busy = data.calendars?.[calendarId]?.busy || [];
    return busy.map((slot: GCalResponse) => ({
      start: new Date(slot.start),
      end: new Date(slot.end),
    }));
  },
};
