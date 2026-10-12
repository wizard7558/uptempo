import type Twilio from "twilio";

let twilioClient: ReturnType<typeof Twilio> | null = null;

/**
 * Lazy-initialised Twilio client singleton.
 * Requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN env vars.
 */
export function getTwilioClient(): ReturnType<typeof Twilio> {
  if (!twilioClient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const twilio = require("twilio") as typeof Twilio;
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error(
        "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN environment variables",
      );
    }
    twilioClient = twilio(accountSid, authToken);
  }
  return twilioClient;
}

/**
 * Returns the Twilio Messaging Service SID.
 * All sends go through the Messaging Service for A2P 10DLC compliance.
 */
export function getMessagingServiceSid(): string {
  const sid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid) {
    throw new Error(
      "Missing TWILIO_MESSAGING_SERVICE_SID environment variable",
    );
  }
  return sid;
}
