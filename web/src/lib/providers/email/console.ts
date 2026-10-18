import type { EmailProvider } from "./types";

export function createConsoleEmailProvider(): EmailProvider {
  return {
    id: "console",
    async send(msg) {
      const payload = {
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.text === undefined ? {} : { text: msg.text }),
      };
      console.log("[Email Dev] Would send email:", JSON.stringify(payload));
      return { success: true };
    },
  };
}
