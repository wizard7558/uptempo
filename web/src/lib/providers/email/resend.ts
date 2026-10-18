import { Resend } from "resend";
import type { EmailProvider } from "./types";

/** Notice sends wait for a bounded provider response while holding a tenant lock. */
class BoundedNoticeResend extends Resend {
  override fetchRequest<T>(path: string, options: object = {}) {
    return super.fetchRequest<T>(path, {
      ...options,
      signal: AbortSignal.timeout(20_000),
    });
  }
}

export function createResendEmailProvider(): EmailProvider {
  return {
    id: "resend",
    async send(msg) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return { success: false, error: "RESEND_API_KEY is not set" };
      }
      try {
        const resend = msg.idempotencyKey
          ? new BoundedNoticeResend(apiKey)
          : new Resend(apiKey);
        const { data, error } = await resend.emails.send({
          from: msg.from,
          to: msg.to,
          ...(msg.bcc ? { bcc: msg.bcc } : {}),
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }, msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined);
        if (error) {
          console.error("[Email] Resend error:", error);
          return { success: false, error: error.message };
        }
        return { success: true, id: data?.id };
      } catch (err) {
        console.error("[Email] Failed to send:", err);
        return {
          success: false,
          error: err instanceof Error ? err.message : "send failed",
        };
      }
    },
  };
}
