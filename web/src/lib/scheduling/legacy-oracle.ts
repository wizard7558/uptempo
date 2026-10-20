/**
 * Test-only. Verbatim pure functions from the deleted legacy files; never import from app code.
 * Sources: availability.ts (generateSlots), smart-scheduling.ts (findProcessingGaps)
 * and slot-fitting.ts (findAvailableStartTimes), all removed in Phase 2.
 */
import { addMinutes } from "date-fns";
import { TZDate } from "@date-fns/tz";

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface WorkingHoursConfig {
  startTime: string; // "09:00"
  endTime: string; // "17:00"
  isEnabled: number; // 0 or 1
}

/**
 * Generates available 15-minute time slots for a given day.
 * Excludes slots that overlap with existing appointments.
 *
 * Working-hour boundaries are interpreted in `businessTimezone` (not the process TZ),
 * so availability matches the business policy on servers running in UTC (CI, Docker, etc.).
 *
 * This is a pure function -- no DB calls. Pass in the data it needs.
 */
export function generateSlots(
  date: Date,
  workingHoursForDay: WorkingHoursConfig,
  existingAppointments: TimeSlot[],
  businessTimezone: string,
  slotDurationMinutes: number = 15,
): TimeSlot[] {
  if (workingHoursForDay.isEnabled === 0) {
    return [];
  }

  const [startH, startM] = workingHoursForDay.startTime.split(":").map(Number);
  const [endH, endM] = workingHoursForDay.endTime.split(":").map(Number);

  const cal = new TZDate(date, businessTimezone);
  const y = cal.getFullYear();
  const mo = cal.getMonth();
  const d = cal.getDate();

  const dayStart = new TZDate(y, mo, d, startH, startM, 0, 0, businessTimezone);
  const dayEnd = new TZDate(y, mo, d, endH, endM, 0, 0, businessTimezone);

  const slots: TimeSlot[] = [];
  let currentMs = dayStart.getTime();
  const endMs = dayEnd.getTime();

  while (currentMs < endMs) {
    const current = new Date(currentMs);
    const slotEnd = addMinutes(current, slotDurationMinutes);
    const slotEndMs = slotEnd.getTime();

    if (slotEndMs > endMs) break;

    const overlaps = existingAppointments.some((appt) => {
      return currentMs < appt.end.getTime() && slotEndMs > appt.start.getTime();
    });

    if (!overlaps) {
      slots.push({ start: new Date(currentMs), end: new Date(slotEndMs) });
    }

    currentMs = slotEndMs;
  }

  return slots;
}

/**
 * A time slot that can be double-booked during another appointment's processing window.
 */
export interface DoubleBookSlot extends TimeSlot {
  isDoubleBook: true;
  duringProcessingOf: string; // appointment ID
}

/**
 * An existing scheduled appointment with processing time information.
 */
export interface ScheduledAppointment {
  id: string;
  start: Date;
  end: Date;
  locationId: string | null;
  activeMinutes: number | null;
  processingMinutes: number | null;
  isDoubleBook: boolean;
  /** Set when this row is a flex booking tied to a host appointment */
  doubleBookParentAppointmentId?: string | null;
}

/**
 * Pure function: finds available double-book slots during processing gaps.
 *
 * For each appointment with active + processing time configured, computes
 * the processing window and checks if the requested service duration fits
 * without conflicting with other non-double-booked appointments.
 */
export function findProcessingGaps(
  existingAppointments: ScheduledAppointment[],
  requestedDurationMinutes: number,
  requiredLocationId?: string | null,
): DoubleBookSlot[] {
  const slots: DoubleBookSlot[] = [];

  // Only consider non-double-booked appointments that have processing time configured
  const processingAppointments = existingAppointments.filter(
    (a) =>
      !a.isDoubleBook &&
      (!requiredLocationId || a.locationId === requiredLocationId) &&
      a.activeMinutes != null &&
      a.activeMinutes > 0 &&
      a.processingMinutes != null &&
      a.processingMinutes > 0,
  );

  // Non-double-booked appointments for conflict checking
  const nonDoubleBookAppointments = existingAppointments.filter(
    (a) => !a.isDoubleBook,
  );

  for (const appt of processingAppointments) {
    // Skip if requested service doesn't fit in the processing window
    if (requestedDurationMinutes > appt.processingMinutes!) continue;

    // Processing window starts after active time ends
    const processingStart = addMinutes(appt.start, appt.activeMinutes!);
    const proposedEnd = addMinutes(processingStart, requestedDurationMinutes);

    // Check for overlap with any OTHER non-double-booked appointment's time range
    const hasConflict = nonDoubleBookAppointments.some((other) => {
      if (other.id === appt.id) return false; // Don't check against the appointment providing the processing gap
      return processingStart < other.end && proposedEnd > other.start;
    });

    const hostAlreadyHasFlexChild = existingAppointments.some(
      (a) =>
        a.isDoubleBook &&
        a.doubleBookParentAppointmentId != null &&
        a.doubleBookParentAppointmentId === appt.id,
    );
    if (hostAlreadyHasFlexChild) continue;

    if (!hasConflict) {
      slots.push({
        start: processingStart,
        end: proposedEnd,
        isDoubleBook: true,
        duringProcessingOf: appt.id,
      });
    }
  }

  return slots;
}

/**
 * Filter available time slots to only those where the full multi-service
 * duration fits within working hours and doesn't conflict with existing appointments.
 *
 * Returns an array of valid start Date objects.
 */
export function findAvailableStartTimes(
  date: Date,
  workingHours: WorkingHoursConfig,
  existingAppointments: TimeSlot[],
  totalDurationMinutes: number,
  businessTimezone: string,
): Date[] {
  const slots = generateSlots(
    date,
    workingHours,
    existingAppointments,
    businessTimezone,
  );

  const [endH, endM] = workingHours.endTime.split(":").map(Number);
  const cal = new TZDate(date, businessTimezone);
  const dayEnd = new TZDate(
    cal.getFullYear(),
    cal.getMonth(),
    cal.getDate(),
    endH,
    endM,
    0,
    0,
    businessTimezone,
  );
  const dayEndMs = dayEnd.getTime();

  const validStartTimes: Date[] = [];

  for (const slot of slots) {
    const proposedEnd = addMinutes(slot.start, totalDurationMinutes);

    if (proposedEnd.getTime() > dayEndMs) {
      continue;
    }

    // Check: does any existing appointment overlap [slot.start, proposedEnd)?
    const hasConflict = existingAppointments.some((appt) => {
      return slot.start < appt.end && proposedEnd > appt.start;
    });

    if (!hasConflict) {
      validStartTimes.push(slot.start);
    }
  }

  return validStartTimes;
}
