/** A client's preferred part of the day, stored as a same-day clock window. */
export type TimeOfDay = "any" | "morning" | "afternoon" | "evening";

const WINDOWS: Record<TimeOfDay, { from: string; to: string }> = {
  any: { from: "00:00", to: "23:59" },
  morning: { from: "00:00", to: "12:00" },
  afternoon: { from: "12:00", to: "17:00" },
  evening: { from: "17:00", to: "23:59" },
};

export function timeOfDayRange(t: TimeOfDay): { from: string; to: string } {
  return WINDOWS[t];
}

export type WaitlistWindow = {
  dateFrom: string;
  dateTo: string;
  timeFrom: string;
  timeTo: string;
  staffId: string | null;
  locationId: string | null;
};

export type OpeningSlot = {
  day: string;
  startHHmm: string;
  endHHmm: string;
  staffId: string;
  locationId: string | null;
};

/**
 * True when the opening falls inside the entry's dates, clock window, staff
 * choice and location. A null staff or location on either side means "any".
 * `endHHmm` is the end of this entry's own service, not the whole opening.
 */
export function entryFits(e: WaitlistWindow, o: OpeningSlot): boolean {
  if (o.day < e.dateFrom || o.day > e.dateTo) return false;
  if (e.timeFrom > o.startHHmm || o.endHHmm > e.timeTo) return false;
  if (e.staffId != null && e.staffId !== o.staffId) return false;
  if (e.locationId != null && o.locationId != null && e.locationId !== o.locationId) return false;
  return true;
}
