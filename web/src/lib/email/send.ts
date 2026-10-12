import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { isSingleMode } from "@/lib/config/mode";
import { getEmailProvider } from "@/lib/providers/email";

const DEFAULT_EMAIL = "noreply@bookuptempo.com";

/**
 * Build a formatted "from" address with optional salon branding.
 *
 * - With salonName: "SalonName via Uptempo <noreply@bookuptempo.com>"
 * - Without salonName: "Uptempo <noreply@bookuptempo.com>"
 *
 * Sanitizes the display name by stripping angle brackets and double quotes,
 * and truncates to 64 characters max.
 */
export function buildFromAddress(salonName?: string): string {
  const emailAddress = process.env.EMAIL_FROM
    ? process.env.EMAIL_FROM.replace(/.*<([^>]+)>.*/, "$1").trim() ||
      DEFAULT_EMAIL
    : DEFAULT_EMAIL;

  let displayName = isSingleMode()
    ? (salonName ?? "Bookings")
    : salonName
      ? `${salonName} via Uptempo`
      : "Uptempo";

  // Sanitize: remove angle brackets and double quotes
  displayName = displayName.replace(/[<>"]/g, "");

  // Truncate to 64 characters
  if (displayName.length > 64) {
    displayName = displayName.slice(0, 64);
  }

  return `${displayName} <${emailAddress}>`;
}

type SendEmailInput = {
  /** A single address, or several. */
  to: string | string[];
  subject: string;
  salonName?: string;
} & ({ react: ReactElement; html?: string } | { html: string; react?: undefined });

/**
 * Send an email through the configured provider.
 * Never throws — returns { success, id? }.
 */
export async function sendEmail(
  input: SendEmailInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const from = buildFromAddress(input.salonName);

  try {
    let html = input.html;
    let text: string | undefined;
    if (input.react) {
      html = await render(input.react);
      text = await render(input.react, { plainText: true });
    }
    if (!html) {
      return { success: false, error: "Email has no body" };
    }
    return await getEmailProvider().send({
      from,
      to: input.to,
      subject: input.subject,
      html,
      text,
    });
  } catch (err) {
    console.error("[Email] Failed to send:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "send failed",
    };
  }
}
