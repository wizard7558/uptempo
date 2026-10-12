import twilio from "twilio";
import { getMessagingServiceSid, getTwilioClient } from "@/lib/sms/client";
import type { SmsProvider } from "./types";

export function createTwilioSmsProvider(): SmsProvider {
  return {
    id: "twilio",
    enabled: true,
    async send(input) {
      try {
        const client: ReturnType<typeof twilio> = getTwilioClient();
        const message = await client.messages.create({
          body: input.body,
          messagingServiceSid: getMessagingServiceSid(),
          to: input.to,
          ...(input.statusCallbackUrl
            ? { statusCallback: input.statusCallbackUrl }
            : {}),
        });
        return { success: true, messageSid: message.sid };
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown Twilio error";
        console.error("[SMS] Failed to send:", error);
        return { success: false, error };
      }
    },
  };
}
