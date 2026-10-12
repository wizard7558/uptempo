import { sendViaLoopMessage } from "@/lib/sms/loopmessage";
import type { SmsProvider } from "./types";

export function createLoopMessageSmsProvider(): SmsProvider {
  return {
    id: "loopmessage",
    enabled: true,
    async send(input) {
      return sendViaLoopMessage({
        to: input.to,
        text: input.body,
        passthrough: input.passthrough,
      });
    },
  };
}
