import { readProviderEnv, resolveSmsProviderId } from "../env";
import { createLogSmsProvider } from "./log";
import { createLoopMessageSmsProvider } from "./loopmessage";
import { createNoneSmsProvider } from "./none";
import { createTwilioSmsProvider } from "./twilio";
import type { SmsProvider } from "./types";

export type { SmsProvider, SmsProviderId, SmsSendInput, SmsSendResult } from "./types";

/**
 * Selects the SMS backend. `log` is a test transport kept outside the public
 * resolver enum so Playwright can set SMS_PROVIDER=log without a Twilio call.
 */
export function getSmsProvider(): SmsProvider {
  if (process.env.SMS_PROVIDER?.trim().toLowerCase() === "log") {
    return createLogSmsProvider();
  }
  switch (resolveSmsProviderId(readProviderEnv())) {
    case "twilio":
      return createTwilioSmsProvider();
    case "loopmessage":
      return createLoopMessageSmsProvider();
    default:
      return createNoneSmsProvider();
  }
}
