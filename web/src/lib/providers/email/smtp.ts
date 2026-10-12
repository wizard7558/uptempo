import nodemailer from "nodemailer";
import type { EmailProvider } from "./types";

export function createSmtpEmailProvider(): EmailProvider {
  return {
    id: "smtp",
    async send(msg) {
      const host = process.env.SMTP_HOST?.trim();
      if (!host) {
        return { success: false, error: "SMTP_HOST is not set" };
      }
      const user = process.env.SMTP_USER?.trim();
      const transport = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: user
          ? { user, pass: process.env.SMTP_PASSWORD ?? "" }
          : undefined,
      });
      try {
        const info = await transport.sendMail({
          from: msg.from,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        });
        return { success: true, id: info.messageId };
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
