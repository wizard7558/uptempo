/**
 * Pure helpers for the weekly hours editor: group stored rows (one per shift)
 * into seven days, and validate the shifts of one day. No I/O.
 */

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type Shift = {
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  locationId: string | null;
};

export type DaySchedule = {
  dayOfWeek: number; // 0 = Sunday
  dayName: string;
  isEnabled: 0 | 1;
  shifts: Shift[];
};

export type WorkingHoursRow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isEnabled: number;
  locationId: string | null;
};

export const DEFAULT_SHIFT_START = "09:00";
export const DEFAULT_SHIFT_END = "17:00";

const byStart = (a: Shift, b: Shift) =>
  a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.endTime < b.endTime ? -1 : a.endTime > b.endTime ? 1 : 0;

/**
 * Groups stored rows into the seven days Sunday..Saturday. A day with no rows
 * gets the default (Monday to Friday open 09:00-17:00 at the default location,
 * weekends closed). A day whose rows are all disabled is closed but keeps the
 * stored times, so switching it back on shows the last hours. Shifts are sorted
 * by start time.
 */
export function groupWeek(
  rows: WorkingHoursRow[],
  defaultLocationId: string | null,
): DaySchedule[] {
  return DAY_NAMES.map((dayName, dayOfWeek) => {
    const dayRows = rows.filter((r) => r.dayOfWeek === dayOfWeek);
    const enabled = dayRows.filter((r) => r.isEnabled === 1);

    if (enabled.length > 0) {
      return {
        dayOfWeek,
        dayName,
        isEnabled: 1 as const,
        shifts: enabled
          .map((r) => ({
            startTime: r.startTime,
            endTime: r.endTime,
            locationId: r.locationId ?? defaultLocationId,
          }))
          .sort(byStart),
      };
    }

    const closedRow = dayRows[0];
    const isDefaultOpen = dayRows.length === 0 && dayOfWeek >= 1 && dayOfWeek <= 5;
    return {
      dayOfWeek,
      dayName,
      isEnabled: isDefaultOpen ? (1 as const) : (0 as const),
      shifts: [
        {
          startTime: closedRow?.startTime ?? DEFAULT_SHIFT_START,
          endTime: closedRow?.endTime ?? DEFAULT_SHIFT_END,
          locationId: defaultLocationId,
        },
      ],
    };
  });
}

/**
 * Checks the shifts of one day. "order" = a shift ends at or before it starts.
 * "overlap" = a shift starts before the previous one ends. Shifts that touch
 * (one ends exactly when the next starts) are allowed.
 */
export function validateShifts(shifts: Shift[]): "order" | "overlap" | null {
  if (shifts.some((s) => s.endTime <= s.startTime)) return "order";
  const sorted = [...shifts].sort(byStart);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startTime < sorted[i - 1].endTime) return "overlap";
  }
  return null;
}
