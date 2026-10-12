import type { EmailProvider } from "./types";

export function createConsoleEmailProvider(): EmailProvider {
  return {
    id: "console",
    async send(msg) {
      console.log("[Email Dev] Would send email:", {
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
      });
      return { success: true };
    },
  };
}
