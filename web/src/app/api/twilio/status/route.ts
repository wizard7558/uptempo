import { NextRequest, NextResponse } from "next/server";
import { validateTwilioWebhook } from "@/lib/sms/validate-webhook";
import { updateSmsMessageStatus } from "@/lib/sms/send";

export const dynamic = "force-dynamic";

/**
 * Twilio delivery status callback handler.
 * Receives status updates for sent SMS messages and updates the
 * sms_messages table accordingly.
 *
 * The tenant slug is passed as a query parameter in the statusCallback URL
 * configured when sending (avoids cross-tenant lookups).
 */
export async function POST(request: NextRequest) {
  const tenantSlug = request.nextUrl.searchParams.get("tenant");
  if (!tenantSlug) {
    return NextResponse.json(
      { error: "Missing tenant parameter" },
      { status: 400 },
    );
  }

  // Parse form data from Twilio
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = value.toString();
  });

  // Validate Twilio request signature
  const signature = request.headers.get("x-twilio-signature");
  const url = request.url;
  if (!validateTwilioWebhook(url, params, signature)) {
    console.warn("[Twilio Status] Invalid webhook signature");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messageSid = params.MessageSid;
  const messageStatus = params.MessageStatus;
  const errorCode = params.ErrorCode;
  const errorMessage = params.ErrorMessage;

  if (!messageSid || !messageStatus) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  try {
    await updateSmsMessageStatus(
      tenantSlug,
      messageSid,
      messageStatus,
      errorCode,
      errorMessage,
    );
  } catch (error) {
    console.error(
      "[Twilio Status] Failed to update message status:",
      error,
    );
    // Still return 200 to prevent Twilio retries on DB errors
  }

  return new NextResponse(null, { status: 200 });
}
