import { addDays, dayOfWeekOf, localDay } from "@/lib/scheduling/intervals";
import type { ClassConflict } from "@/lib/classes/enroll";

/** Pure helpers for the admin class schedule. No server imports, so client code can use them too. */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isDay(value: string | undefined | null): value is string {
  if (!value || !DAY_RE.test(value)) return false;
  return addDays(value, 0) === value;
}

/** The Monday of the week that holds `day`. */
export function weekStartOf(day: string): string {
  return addDays(day, -((dayOfWeekOf(day) + 6) % 7));
}

/** The week to show: the `?week=` value when it is a real date, otherwise the week that holds `today`. */
export function resolveWeek(param: string | undefined | null, today: string): string {
  return weekStartOf(isDay(param) ? param : today);
}

/** Replaces the narrow no-break spaces some Node versions put before AM/PM. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

export function formatClockTime(date: Date, timezone: string): string {
  return plain(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(date),
  );
}

/** "6:00 AM to 6:45 AM". */
export function formatTimeRange(start: Date, end: Date, timezone: string): string {
  return `${formatClockTime(start, timezone)} to ${formatClockTime(end, timezone)}`;
}

/** "Mon, Jun 15" for a YYYY-MM-DD day. */
export function formatDayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** "Jun 15 to Jun 21" for the week that starts on `weekStart`. */
export function formatWeekRange(weekStart: string): string {
  const short = (day: string) => formatDayLabel(day).replace(/^\w+, /, "");
  return `${short(weekStart)} to ${short(addDays(weekStart, 6))}`;
}

export type DayGroup<T> = { day: string; label: string; sessions: T[] };

/** Groups sessions (already sorted by start) by the business's local day. Days with no class are left out. */
export function groupByDay<T extends { start: Date }>(sessions: T[], timezone: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const s of sessions) {
    const day = localDay(s.start, timezone);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.sessions.push(s);
    else groups.push({ day, label: formatDayLabel(day), sessions: [s] });
  }
  return groups;
}

/**
 * "Save anyway" may only be offered when every clash is an appointment.
 * A database rule forbids overlapping time blocks, so any other kind cannot be overridden.
 */
export function canSaveAnyway(conflicts: ClassConflict[]): boolean {
  return conflicts.length > 0 && conflicts.every((c) => c.reason === "appointment");
}

/** Start times every 15 minutes, as "HH:mm" with an "h:mm AM" label. */
export function startTimeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let mins = 0; mins < 24 * 60; mins += 15) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    out.push({
      value: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      label: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`,
    });
  }
  return out;
}
