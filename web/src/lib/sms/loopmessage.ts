import { getBaseUrl } from "@/lib/utils";

/**
 * LoopMessage transport (iMessage). Low-level send used by sendSms() when
 * SMS_PROVIDER=loopmessage. Consent, quiet-hours, and logging are handled by
 * the caller — this only performs the network send.
 *
 * Env (set in .env.local / Vercel, never commit):
 *   LOOPMESSAGE_AUTH_KEY    (required) — Authorization header value
 *   LOOPMESSAGE_SECRET_KEY  (optional) — sent as Loop-Secret-Key if your account issues one
 *   LOOPMESSAGE_SENDER      (optional) — sender name; ignored for sandbox contacts
 *
 * When LOOPMESSAGE_AUTH_KEY is absent (local/dev/test) this is a logged no-op
 * that "succeeds", mirroring src/lib/email/send.ts and the Twilio path.
 */

const ENDPOINT = "https://a.loopmessage.com/api/v1/message/send/";

interface LoopSendParams {
  to: string;
  text: string;
  /** Forwarded to LoopMessage and echoed back on webhooks for correlation. */
  passthrough?: string;
}

interface LoopSendResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

export function isLoopMessageConfigured(): boolean {
  return Boolean(process.env.LOOPMESSAGE_AUTH_KEY);
}

export async function sendViaLoopMessage({
  to,
  text,
  passthrough,
}: LoopSendParams): Promise<LoopSendResult> {
  const authKey = process.env.LOOPMESSAGE_AUTH_KEY;
  if (!authKey) {
    console.log(`[LoopMessage] Not configured — skipping iMessage to ${to}`);
    return { success: true, messageSid: "loopmessage-dev-noop" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authKey,
  };
  if (process.env.LOOPMESSAGE_SECRET_KEY) {
    headers["Loop-Secret-Key"] = process.env.LOOPMESSAGE_SECRET_KEY;
  }

  const body: Record<string, unknown> = { contact: to, text };
  if (process.env.LOOPMESSAGE_SENDER) body.sender = process.env.LOOPMESSAGE_SENDER;
  if (passthrough) body.passthrough = passthrough;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let data: { message_id?: string; success?: boolean; message?: string } = {};
    try {
      data = JSON.parse(raw);
    } catch {
      /* non-JSON body */
    }

    const ok = res.ok && data.success !== false;
    if (!ok) {
      const error = data.message || raw || `HTTP ${res.status}`;
      console.error("[LoopMessage] Send failed:", error);
      return { success: false, error };
    }

    return { success: true, messageSid: data.message_id };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown LoopMessage error";
    console.error("[LoopMessage] Network error:", error);
    return { success: false, error };
  }
}

/** Base URL for the LoopMessage webhook callback (configure in the dashboard). */
export function loopMessageWebhookUrl(): string {
  return `${getBaseUrl()}/api/loopmessage/webhook`;
}
