import { NextResponse } from "next/server";
import { updateSmsMessageStatus } from "@/lib/sms/send";

export const dynamic = "force-dynamic";

/**
 * LoopMessage webhook handler (delivery status + inbound).
 *
 * Configure this URL in the LoopMessage dashboard. LoopMessage expects an
 * HTTP 200 within 15s or it retries; we always 200 and do best-effort work.
 *
 * We sent each message with `passthrough = <tenantSlug>`, so status events
 * carry it back and we can update the right tenant's sms_messages row without
 * a cross-tenant scan.
 *
 * NOTE: confirm exact field names against the LoopMessage webhook docs; we read
 * them defensively (`alert_type`, `message_id`, `passthrough`).
 */
export async function POST(request: Request) {
  let payload: Record<string, unknown> = {};
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const alertType = String(payload.alert_type ?? payload.type ?? "");
  const messageId = payload.message_id ? String(payload.message_id) : null;
  const tenantSlug = payload.passthrough ? String(payload.passthrough) : null;

  // Map LoopMessage event → our sms_messages status.
  const statusByAlert: Record<string, string> = {
    message_scheduled: "queued",
    message_sent: "delivered",
    message_delivered: "delivered",
    message_failed: "failed",
  };
  const status = statusByAlert[alertType];

  if (tenantSlug && messageId && status) {
    try {
      const errorCode = payload.error_code ? String(payload.error_code) : undefined;
      const errorMessage = payload.error_message
        ? String(payload.error_message)
        : undefined;
      await updateSmsMessageStatus(
        tenantSlug,
        messageId,
        status,
        errorCode,
        errorMessage,
      );
    } catch (error) {
      console.error("[LoopMessage] webhook status update failed:", error);
      // Still 200 so LoopMessage doesn't retry indefinitely.
    }
  } else if (alertType === "message_inbound") {
    // Inbound message (e.g. a reply). STOP/HELP keyword handling can be added
    // here later; for now just acknowledge.
    console.log("[LoopMessage] inbound message received");
  }

  return NextResponse.json({ ok: true });
}
