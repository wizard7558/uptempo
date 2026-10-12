import type { BusySource } from "./load";
import type { RejectReason } from "./types";

export type BookingFailureCode =
  | "SLOT_TAKEN"
  | "RESOURCE_TAKEN"
  | "BLOCKED"
  | "TOO_SOON"
  | "TOO_FAR"
  | "STAFF_UNAVAILABLE"
  /** An on-site job the staff member cannot reach in time (or at all). */
  | "TOO_FAR_TO_TRAVEL"
  /** The service address does not belong to the client. */
  | "INVALID_ADDRESS"
  /** The staff member's books are closed on that date (or entirely). */
  | "BOOKS_CLOSED"
  /** A flex (double-book) child that does not fit its host; the caller supplies the message. */
  | "INVALID_FLEX";

/** Collapses engine reject reasons into the single code shown to the caller. */
export function failureCodeFor(r: RejectReason[]): BookingFailureCode {
  if (r.includes("BUSY_APPOINTMENT") || r.includes("BUSY_EXTERNAL") || r.includes("BUSY_CLASS")) {
    return "SLOT_TAKEN";
  }
  if (r.includes("RESOURCE_UNAVAILABLE")) return "RESOURCE_TAKEN";
  if (r.includes("BUSY_BLOCK")) return "BLOCKED";
  if (r.includes("TOO_SOON")) return "TOO_SOON";
  if (r.includes("TOO_FAR")) return "TOO_FAR";
  if (r.includes("TRAVEL")) return "TOO_FAR_TO_TRAVEL";
  if (r.includes("WINDOW_CLOSED")) return "BOOKS_CLOSED";
  return "STAFF_UNAVAILABLE";
}

export type BookingMode = "public" | "series" | "override" | "reschedule";

/** Reasons that reject a booking in each mode. `null` = every reason rejects. */
export const MODE_REASONS: Record<BookingMode, ReadonlySet<RejectReason> | null> = {
  public: null,
  series: new Set<RejectReason>([
    "CLOSED_DAY",
    "OUTSIDE_HOURS",
    "BUSY_APPOINTMENT",
    "BUSY_BLOCK",
    "BUSY_EXTERNAL",
    "BUSY_CLASS",
    "RESOURCE_UNAVAILABLE",
    "TRAVEL",
  ]),
  override: new Set<RejectReason>(["BUSY_BLOCK", "RESOURCE_UNAVAILABLE"]),
  reschedule: new Set<RejectReason>(["BUSY_APPOINTMENT", "BUSY_BLOCK", "RESOURCE_UNAVAILABLE"]),
};

const ALL_SOURCES: readonly BusySource[] = ["appointment", "block", "external", "task"];

/** Which busy sources are loaded for each mode. */
export const MODE_KINDS: Record<BookingMode, readonly BusySource[]> = {
  public: ALL_SOURCES,
  series: ALL_SOURCES,
  override: ["block"],
  reschedule: ["appointment", "block"],
};
