/**
 * Dashboard presentation helpers
 * ------------------------------
 * Pure, DB-free formatting and shaping used by the admin dashboard page and its
 * client components. Kept separate from `getDashboardData` so the presentation
 * arithmetic (greeting, cumulative line, KPI tone) is unit testable in
 * isolation. Money is always in cents.
 */

import { TZDate } from "@date-fns/tz";

export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

/**
 * Hour of day (0–23) for an instant, read in the given IANA timezone. Uses the
 * same `@date-fns/tz` mechanism the rest of the app formats appointment times
 * with, so production (which runs UTC) still greets by the salon's wall clock.
 */
export function zonedHour(instant: Date, timeZone: string): number {
  return new TZDate(instant, timeZone).getHours();
}

/** Time-of-day greeting from a 0–23 hour. */
export function greetingForHour(hour: number): Greeting {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** First word of a display name, or null when there is nothing usable. */
export function firstNameOf(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const first = fullName.trim().split(/\s+/)[0];
  return first.length > 0 ? first : null;
}

export interface CumulativePoint {
  date: string;
  cumulativeCents: number;
}

/**
 * Running total of a per-day revenue series, so the chart reads as a rising
 * month-to-date line rather than a noisy daily bar shape.
 */
export function cumulativeRevenueSeries(
  series: { date: string; revenueCents: number }[],
): CumulativePoint[] {
  let running = 0;
  return series.map((p) => {
    running += p.revenueCents;
    return { date: p.date, cumulativeCents: running };
  });
}

export type Tone = "positive" | "negative" | "neutral";

/**
 * Whether a month-over-month delta is good for the business. `higherIsBetter`
 * is false for metrics like cancellation rate, where a drop is the win.
 */
export function kpiTone(
  delta: number,
  opts: { higherIsBetter: boolean },
): Tone {
  if (delta === 0) return "neutral";
  const good = opts.higherIsBetter ? delta > 0 : delta < 0;
  return good ? "positive" : "negative";
}

/** "↑" for a positive delta, "↓" for negative, "→" for no change. */
export function deltaArrow(delta: number): "↑" | "↓" | "→" {
  if (delta > 0) return "↑";
  if (delta < 0) return "↓";
  return "→";
}

/** Whole-dollar string with thousands separators: 123456 -> "$1,235". */
export function formatDollars(cents: number): string {
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

/** Signed whole-dollar string using a true minus glyph: -50000 -> "−$500". */
export function formatSignedDollars(cents: number): string {
  const sign = cents < 0 ? "−" : "+";
  return `${sign}${formatDollars(Math.abs(cents))}`;
}

/** Signed percentage-point string from a 0–1 delta: 0.021 -> "2.1%". */
export function formatPercentPoints(ratioDelta: number): string {
  return `${(Math.abs(ratioDelta) * 100).toFixed(1)}%`;
}

/** One-decimal magnitude for unit deltas like booked-out weeks. */
export function formatUnitMagnitude(delta: number): string {
  return Math.abs(delta).toFixed(1);
}
