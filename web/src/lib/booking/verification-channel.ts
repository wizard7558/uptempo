import { isSingleMode } from "@/lib/config/mode";
import { resolveSmsProviderId } from "@/lib/providers/env";

export type BookingVerificationChannel = "email" | "phone";

/** Use email verification when a single-mode install has no SMS provider. */
export function getBookingVerificationChannel(): BookingVerificationChannel {
  const smsProvider = resolveSmsProviderId({
    SMS_PROVIDER: process.env.SMS_PROVIDER,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  });

  return isSingleMode() && smsProvider === "none"
    ? "email"
    : "phone";
}
