/**
 * Recurrence rules for repeating bookings. Only "every week" and "every 2 weeks"
 * exist, so this is a small pure module rather than a general RRULE parser.
 * Every visit keeps its local wall-clock time, also across daylight saving changes.
 */
import { addDays, localDay, wallClockToDate } from "./intervals";

export type IntervalWeeks = 1 | 2;

const RRULES: Record<IntervalWeeks, string> = {
  1: "FREQ=WEEKLY;INTERVAL=1",
  2: "FREQ=WEEKLY;INTERVAL=2",
};

/** The stored rule text for a repeat every `intervalWeeks` weeks. */
export function toRrule(intervalWeeks: IntervalWeeks): string {
  return RRULES[intervalWeeks];
}

/** Reads a stored rule. Throws on anything but the two supported rules. */
export function parseRrule(rrule: string): { intervalWeeks: IntervalWeeks } {
  if (rrule === RRULES[1]) return { intervalWeeks: 1 };
  if (rrule === RRULES[2]) return { intervalWeeks: 2 };
  throw new Error(`Unsupported recurrence rule "${rrule}"`);
}

export type RecurrenceShape = {
  rrule: string;
  startsAt: Date;
  until: Date | null;
  count: number | null;
  timezone: string;
};

/** Local "HH:mm" of an instant in `timezone`. */
function localTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/** Start of visit number `index` (0 is the first visit): same local time, `7 * interval * index` days later. */
export function occurrenceStart(rule: RecurrenceShape, index: number): Date {
  const { intervalWeeks } = parseRrule(rule.rrule);
  const day = addDays(localDay(rule.startsAt, rule.timezone), 7 * intervalWeeks * index);
  return wallClockToDate(day, localTime(rule.startsAt, rule.timezone), rule.timezone);
}

const MAX_ITERATIONS = 1000;

/**
 * Visits starting after `afterExclusive` and at or before `throughInclusive`,
 * in order. Stops at `count` visits or at `until`.
 */
export function occurrencesBetween(
  rule: RecurrenceShape,
  afterExclusive: Date,
  throughInclusive: Date,
): { index: number; start: Date }[] {
  const out: { index: number; start: Date }[] = [];
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (rule.count != null && i >= rule.count) break;
    const start = occurrenceStart(rule, i);
    if (rule.until != null && start > rule.until) break;
    if (start > throughInclusive) break;
    if (start > afterExclusive) out.push({ index: i, start });
  }
  return out;
}
