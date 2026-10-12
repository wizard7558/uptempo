/**
 * Request and quote lifecycle (plan decision D4). Pure so the transitions are
 * unit-tested without a database. The database CHECK constraints list the same
 * values; the rules for moving between them live only here.
 */
export type RequestStatus =
  | "new"
  | "reviewing"
  | "quoted"
  | "accepted"
  | "declined"
  | "converted"
  | "expired";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "withdrawn";

export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  new: ["reviewing", "quoted", "declined"],
  reviewing: ["quoted", "declined"],
  // quoted -> reviewing is a withdraw; quoted -> expired is the lazy expiry;
  // quoted -> accepted is the client's claim; quoted -> declined is "No thanks".
  quoted: ["reviewing", "expired", "declined", "accepted"],
  // accepted -> converted when the booking succeeded; back to quoted when it failed.
  accepted: ["converted", "quoted"],
  expired: ["quoted"],
  declined: [],
  converted: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses an owner can still decline from. */
export const DECLINABLE: readonly RequestStatus[] = ["new", "reviewing", "quoted"];

/** How long a sent quote stays open, in days. */
export const QUOTE_VALID_DAYS = [7, 14, 30, 60] as const;
export type QuoteValidDays = (typeof QUOTE_VALID_DAYS)[number];
