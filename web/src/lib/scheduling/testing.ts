/**
 * Test-only builders shared by the engine test files.
 * Not exported from the engine; contains no I/O.
 */
import { wallClockToDate } from "./intervals";
import type { Busy, EngineInput, Interval, WeeklyHours } from "./types";

export const TZ = "America/New_York";
export const DAY = "2026-06-17"; // Wednesday, EDT

export function at(hhmm: string, day: string = DAY, tz: string = TZ): Date {
  return wallClockToDate(day, hhmm, tz);
}

export function iv(start: string, end: string, day: string = DAY, tz: string = TZ): Interval {
  return { start: at(start, day, tz), end: at(end, day, tz) };
}

export function weekly(
  staffId: string,
  start = "09:00",
  end = "17:00",
  locationId: string | null = null,
): WeeklyHours {
  return ([0, 1, 2, 3, 4, 5, 6] as const).map((dayOfWeek) => ({
    staffId,
    dayOfWeek,
    start,
    end,
    locationId,
  }));
}

export function busy(
  staffId: string,
  start: string,
  end: string,
  kind: Busy["kind"] = "appointment",
  extra: Partial<Busy> = {},
): Busy {
  return { staffId, interval: iv(start, end), kind, ...extra };
}

export function makeInput(over: Partial<EngineInput> = {}): EngineInput {
  const base: EngineInput = {
    day: DAY,
    candidateStaffIds: ["a"],
    anyStaff: false,
    hours: weekly("a"),
    overrides: [],
    busy: [],
    resources: [],
    service: {
      totalMinutes: 60,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      resourceNeeds: [],
      locationType: "in_studio",
    },
    rules: {
      timezone: TZ,
      now: new Date("2026-06-01T00:00:00Z"),
      minNoticeMinutes: 0,
      maxAdvanceDays: 60,
      slotIntervalMinutes: 15,
      allowFlex: false,
    },
  };
  return { ...base, ...over };
}

/** HH:mm wall-clock labels (in TZ) of slot starts, for readable assertions. */
export function labels(starts: Date[], tz: string = TZ): string[] {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return starts.map((d) => f.format(d));
}
