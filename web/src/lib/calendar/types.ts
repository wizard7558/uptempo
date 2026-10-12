/**
 * Shared types for the calendar provider abstraction (Google Calendar API v3).
 */

export type CalendarPlatform = "google_calendar";

export interface CalendarInfo {
  id: string;
  name: string;
  primary: boolean;
  accessRole: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  attendees?: Array<{ email: string; name?: string; responseStatus?: string }>;
  location?: string;
  htmlLink?: string;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone: string;
  attendees?: Array<{ email: string; name?: string }>;
  location?: string;
}

export interface FreeBusySlot {
  start: Date;
  end: Date;
}

export interface CalendarProvider {
  listCalendars(accessToken: string): Promise<CalendarInfo[]>;
  listEvents(
    accessToken: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<CalendarEvent[]>;
  createEvent(
    accessToken: string,
    calendarId: string,
    event: CreateEventInput,
  ): Promise<CalendarEvent>;
  deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
  ): Promise<void>;
  getFreeBusy(
    accessToken: string,
    calendarId: string,
    timeMin: Date,
    timeMax: Date,
  ): Promise<FreeBusySlot[]>;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

export interface PlatformUserInfo {
  id: string;
  email: string;
}
