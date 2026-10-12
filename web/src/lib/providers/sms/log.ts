import crypto from "crypto";
import type { SmsProvider } from "./types";

/**
 * Dev and Playwright transport. SMS_PROVIDER=log is not a hosted selection.
 * It writes sms_messages through sendSms and never calls Twilio.
 */
export function createLogSmsProvider(): SmsProvider {
  return {
    id: "log",
    enabled: true,
    async send(input) {
      console.info("[sms:log]", input.to, input.body);
      return { success: true, messageSid: "log-" + crypto.randomUUID() };
    },
  };
}
