import { withTenantDb } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { isSingleMode } from "@/lib/config/mode";
import { checkSmsConsent } from "./consent";
import { getSmsProvider } from "@/lib/providers/sms";
import { isWithinSendWindow } from "./quiet-hours";
import { getBaseUrl } from "@/lib/utils";
import { toPlainSms } from "./plain-text";

interface SendSmsParams {
  to: string;
  body: string;
  tenantSlug: string;
  clientId?: string;
  appointmentId?: string;
  messageType?: string;
}

interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  error?: string;
}

/**
 * Send an SMS with consent and quiet hours gates.
 *
 * Gate 1: Checks SMS consent for the recipient phone in the tenant.
 * Gate 2: Checks business timezone for quiet hours (8 AM - 9 PM).
 *
 * If both gates pass, sends via Twilio Messaging Service and logs
 * the message in the sms_messages table.
 */
export async function sendSms({
  to,
  body: rawBody,
  tenantSlug,
  clientId,
  appointmentId,
  messageType = "reminder",
}: SendSmsParams): Promise<SendSmsResult> {
  const provider = getSmsProvider();
  if (!provider.enabled) {
    return { success: false, error: "sms_disabled" };
  }
  let messagingServiceSid: string | undefined;
  if (!isSingleMode()) {
    const [tenant] = await publicDb
      .select({ smsLineStatus: tenants.smsLineStatus, smsMessagingServiceSid: tenants.smsMessagingServiceSid })
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1);
    if (tenant?.smsLineStatus === "shared") {
      // Shared beta traffic continues through the platform's pooled sender.
    } else if (tenant?.smsLineStatus === "active" && tenant.smsMessagingServiceSid) {
      messagingServiceSid = tenant.smsMessagingServiceSid;
    } else {
      return { success: false, error: "text_line_off" };
    }
    if (messagingServiceSid && provider.id === "loopmessage") {
      // LoopMessage cannot select the tenant-owned Twilio service for an active
      // hosted line; fail closed rather than silently using its send route.
      return { success: false, error: "sms_provider_incompatible" };
    }
  }
  const body = toPlainSms(rawBody);
  // Gate 1: Consent check
  const hasConsent = await checkSmsConsent(tenantSlug, to);
  if (!hasConsent) {
    return { success: false, error: "no_consent" };
  }

  // Gate 2: Quiet hours check — get business timezone from policies
  const businessTimezone = await withTenantDb(
    tenantSlug,
    async (db, { businessSettings }) => {
      const [policy] = await db
        .select({ timezone: businessSettings.timezone })
        .from(businessSettings)
        .limit(1);
      return policy?.timezone ?? "America/New_York";
    },
  );

  if (!isWithinSendWindow(businessTimezone)) {
    return { success: false, error: "quiet_hours" };
  }

  const result = await provider.send({
    to,
    body,
    statusCallbackUrl: `${getBaseUrl()}/api/twilio/status?tenant=${encodeURIComponent(tenantSlug)}`,
    passthrough: tenantSlug,
    ...(messagingServiceSid ? { messagingServiceSid } : {}),
  });

  if (result.success) {
    await logSmsMessage({
      tenantSlug,
      messageSid: result.messageSid,
      toPhone: to,
      body,
      status: "queued",
      messageType,
      clientId,
      appointmentId,
    });
    return { success: true, messageSid: result.messageSid };
  }

  await logSmsMessage({
    tenantSlug,
    toPhone: to,
    body,
    status: "failed",
    messageType,
    clientId,
    appointmentId,
    errorMessage: result.error,
  });
  return { success: false, error: result.error };
}

interface LogSmsMessageParams {
  tenantSlug: string;
  messageSid?: string;
  toPhone: string;
  body: string;
  status: string;
  messageType: string;
  clientId?: string;
  appointmentId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Insert a row into the tenant's sms_messages table.
 */
export async function logSmsMessage(
  params: LogSmsMessageParams,
): Promise<void> {
  await withTenantDb(params.tenantSlug, async (db, { smsMessages }) => {
    await db.insert(smsMessages).values({
      messageSid: params.messageSid ?? null,
      toPhone: params.toPhone,
      body: params.body,
      status: params.status,
      messageType: params.messageType,
      clientId: params.clientId ?? null,
      appointmentId: params.appointmentId ?? null,
      errorCode: params.errorCode ?? null,
      errorMessage: params.errorMessage ?? null,
    });
  });
}

/**
 * Update the status of an SMS message by its Twilio message SID.
 * Used by the Twilio status callback webhook.
 */
export async function updateSmsMessageStatus(
  tenantSlug: string,
  messageSid: string,
  status: string,
  errorCode?: string,
  errorMessage?: string,
): Promise<void> {
  await withTenantDb(tenantSlug, async (db, { smsMessages }) => {
    await db
      .update(smsMessages)
      .set({
        status,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        updatedAt: new Date(),
      })
      .where(eq(smsMessages.messageSid, messageSid));
  });
}
