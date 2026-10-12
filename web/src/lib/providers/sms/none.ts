import type { SmsProvider } from "./types";

export function createNoneSmsProvider(): SmsProvider {
  return {
    id: "none",
    enabled: false,
    async send() {
      return { success: false, error: "sms_disabled" };
    },
  };
}
