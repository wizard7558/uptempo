export type VisitWord =
  | "confirmed"
  | "checkedIn"
  | "noShow"
  | "completed"
  | "cancelled"
  | "pending";

/** Checked in is a timestamp. It does not replace the appointment status. */
export function visitWord(
  status: string,
  checkedInAt: Date | string | null | undefined,
): VisitWord {
  if (
    checkedInAt &&
    status !== "cancelled" &&
    status !== "no_show" &&
    status !== "completed"
  ) {
    return "checkedIn";
  }
  if (status === "no_show") return "noShow";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "pending") return "pending";
  return "confirmed";
}
