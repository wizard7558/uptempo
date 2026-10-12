import { getT } from "@/lib/terms/server";
import type { BookingFailureCode } from "@/lib/scheduling/reasons";

/** User-facing text for a booking the scheduling engine rejected. */
export async function failureMessage(code: BookingFailureCode, slug: string): Promise<string> {
  const t = await getT("errors", slug);
  switch (code) {
    case "SLOT_TAKEN":
      return "Time slot conflicts with an existing appointment";
    case "RESOURCE_TAKEN":
      return t("appointments.resourceTaken");
    case "BLOCKED":
      return "That time is blocked (buffer / time off)";
    case "TOO_SOON":
      return t("appointments.tooSoon");
    case "TOO_FAR":
      return t("appointments.tooFar");
    case "TOO_FAR_TO_TRAVEL":
      return t("appointments.tooFarToTravel");
    case "BOOKS_CLOSED":
      return t("appointments.booksClosed");
    case "INVALID_ADDRESS":
      return t("appointments.invalidAddress");
    case "STAFF_UNAVAILABLE":
      return t("appointments.staffUnavailable");
    case "INVALID_FLEX":
      return "Failed to create booking";
  }
}
