import { isSingleMode } from "@/lib/config/mode";
import { resolveSmsProviderId } from "@/lib/providers/env";

export type BookingVerificationChannel = "email" | "phone";

/** Use email verification when a single-mode install has no SMS provider. */
export function getBookingVerificationChannel(): BookingVerificationChannel {
  // The log transport is a test/development SMS sink accepted by the SMS
  // factory, but it is intentionally not a selectable production provider.
  // Treat it as phone-capable here so booking pages can render under Playwright.
  if (process.env.SMS_PROVIDER?.trim().toLowerCase() === "log") {
    return "phone";
  }

  const smsProvider = resolveSmsProviderId({
    SMS_PROVIDER: process.env.SMS_PROVIDER,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  });

  return isSingleMode() && smsProvider === "none"
    ? "email"
    : "phone";
}
