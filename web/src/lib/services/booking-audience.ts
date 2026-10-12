/**
 * Per-service online booking audience — single source of truth for who may
 * self-book a service on the public booking page.
 *
 *   'all'       — anyone (default)
 *   'new'       — first-time clients only
 *   'returning' — returning clients only
 *
 * "New" matches the platform-wide definition used for
 * `appointments.client_status_at_booking`: a client with zero appointments
 * booked. Staff/admin booking is never restricted by audience.
 */

export const BOOKING_AUDIENCES = ["all", "new", "returning"] as const;
export type BookingAudience = (typeof BOOKING_AUDIENCES)[number];

export function isBookingAudience(value: unknown): value is BookingAudience {
  return (
    typeof value === "string" &&
    (BOOKING_AUDIENCES as readonly string[]).includes(value)
  );
}

/** Same semantics as client_status_at_booking ("new" vs "repeat"). */
export function isNewClient(
  appointmentsBooked: number | null | undefined,
): boolean {
  return (appointmentsBooked ?? 0) === 0;
}

/**
 * May a client with the given newness self-book a service with this audience?
 * Unknown/legacy audience values behave as 'all' (fail open — the column
 * defaults to 'all' and the admin UI only writes known values).
 */
export function canClientBookService(
  audience: string | null | undefined,
  isNew: boolean,
): boolean {
  switch (audience) {
    case "new":
      return isNew;
    case "returning":
      return !isNew;
    default:
      return true;
  }
}

/** Human label for admin UI badges/selects. */
export function bookingAudienceLabel(audience: string): string {
  switch (audience) {
    case "new":
      return "New clients only";
    case "returning":
      return "Returning clients";
    default:
      return "Everyone";
  }
}
