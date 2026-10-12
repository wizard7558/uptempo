import { TZDate } from "@date-fns/tz";
import type { Interval } from "./types";

/** Half-open overlap: [a.start, a.end) vs [b.start, b.end). Touching intervals do not overlap. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && a.end.getTime() > b.start.getTime();
}

/** True when `inner` lies fully inside `outer` (edges may touch). */
export function contains(outer: Interval, inner: Interval): boolean {
  return (
    outer.start.getTime() <= inner.start.getTime() &&
    inner.end.getTime() <= outer.end.getTime()
  );
}

/** Sort and merge overlapping or touching intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.end.getTime() > i.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start.getTime() <= last.end.getTime()) {
      if (cur.end.getTime() > last.end.getTime()) {
        out[out.length - 1] = { start: last.start, end: cur.end };
      }
    } else {
      out.push({ start: cur.start, end: cur.end });
    }
  }
  return out;
}

/** Remove every `cuts` interval from `base`. Result is sorted and non-empty pieces only. */
export function subtract(base: Interval, cuts: Interval[]): Interval[] {
  let pieces: Interval[] = [{ start: base.start, end: base.end }];
  for (const cut of mergeIntervals(cuts)) {
    const next: Interval[] = [];
    for (const p of pieces) {
      if (!overlaps(p, cut)) {
        next.push(p);
        continue;
      }
      if (p.start.getTime() < cut.start.getTime()) {
        next.push({ start: p.start, end: cut.start });
      }
      if (cut.end.getTime() < p.end.getTime()) {
        next.push({ start: cut.end, end: p.end });
      }
    }
    pieces = next;
  }
  return pieces;
}

function parseDay(day: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Invalid day "${day}", expected YYYY-MM-DD`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Wall-clock "HH:mm" on calendar date `day` in `timezone` -> instant.
 * DST-safe: a nonexistent time (spring forward gap) resolves forward, an
 * ambiguous time (fall back) resolves to the later (standard-time) occurrence. "24:00" is
 * midnight at the end of the day.
 */
export function wallClockToDate(day: string, hhmm: string, timezone: string): Date {
  const [y, mo, d] = parseDay(day);
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:mm`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const first = new TZDate(y, mo - 1, d, hour, minute, 0, 0, timezone);
  const laterMs = first.getTime() + 60 * 60 * 1000;
  const laterLocal = new TZDate(laterMs, timezone);
  const sameWallClock =
    laterLocal.getFullYear() === first.getFullYear() &&
    laterLocal.getMonth() === first.getMonth() &&
    laterLocal.getDate() === first.getDate() &&
    laterLocal.getHours() === first.getHours() &&
    laterLocal.getMinutes() === first.getMinutes();
  return new Date(sameWallClock ? laterMs : first.getTime());
}

/** Day of week (0 = Sunday) of a calendar date string. Timezone independent. */
export function dayOfWeekOf(day: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const [y, mo, d] = parseDay(day);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/** Calendar date ("YYYY-MM-DD") of an instant as seen in `timezone`. */
export function localDay(date: Date, timezone: string): string {
  const t = new TZDate(date.getTime(), timezone);
  const mm = String(t.getMonth() + 1).padStart(2, "0");
  const dd = String(t.getDate()).padStart(2, "0");
  return `${String(t.getFullYear()).padStart(4, "0")}-${mm}-${dd}`;
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parseDay(from);
  const [ty, tm, td] = parseDay(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Calendar date `n` days after `day` (negative `n` goes back). Timezone independent. */
export function addDays(day: string, n: number): string {
  const [y, mo, d] = parseDay(day);
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${mm}-${dd}`;
}

/** Minutes from `now` until the next local midnight in `tz` (rounded up). */
export function minutesUntilNextLocalMidnight(now: Date, tz: string): number {
  const next = wallClockToDate(addDays(localDay(now, tz), 1), "00:00", tz);
  return Math.ceil((next.getTime() - now.getTime()) / 60_000);
}
