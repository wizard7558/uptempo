import { TZDate } from "@date-fns/tz";
import { getHours } from "date-fns";

/** SMS quiet hours start (9 PM salon time) — no sends at or after this hour */
export const QUIET_HOURS_START = 21;

/** SMS quiet hours end (8 AM salon time) — no sends before this hour */
export const QUIET_HOURS_END = 8;

/**
 * Check if the current time is within the allowed SMS send window
 * for the given business timezone.
 *
 * SMS may only be sent between 8 AM (inclusive) and 9 PM (exclusive)
 * in the business's local timezone per TCPA quiet hours guidelines.
 *
 * @param businessTimezone - IANA timezone string (e.g., "America/New_York")
 * @returns true if current time is within the send window
 */
export function isWithinSendWindow(businessTimezone: string, at: Date = new Date()): boolean {
  const now = new TZDate(at, businessTimezone);
  const hour = getHours(now);
  return hour >= QUIET_HOURS_END && hour < QUIET_HOURS_START;
}
