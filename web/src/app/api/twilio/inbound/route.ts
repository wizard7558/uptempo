import { NextRequest, NextResponse } from "next/server";
import { validateTwilioWebhook } from "@/lib/sms/validate-webhook";
import { listActiveTenants } from "@/lib/tenant/registry";
import { revokeSmsConsent, recordSmsConsent } from "@/lib/sms/consent";
import { withTenantDb } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const OPT_OUT_KEYWORDS = [
  "STOP",
  "UNSUBSCRIBE",
  "END",
  "QUIT",
  "CANCEL",
  "OPTOUT",
];
const OPT_IN_KEYWORDS = ["START", "UNSTOP", "YES"];

/**
 * Inbound SMS handler for STOP/START keyword processing.
 *
 * When a client texts STOP, we revoke consent across all tenants
 * for TCPA audit trail purposes. When they text START, we re-record
 * consent for tenants where they have a client record.
 *
 * Note: Twilio's Advanced Opt-Out already blocks sends to opted-out
 * numbers (error 21610). This webhook provides the TCPA audit trail
 * on our side.
 */
export async function POST(request: NextRequest) {
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
    console.warn("[Twilio Inbound] Invalid webhook signature");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromPhone = params.From;
  const body = (params.Body ?? "").trim().toUpperCase();

  if (!fromPhone) {
    return NextResponse.json(
      { error: "Missing From field" },
      { status: 400 },
    );
  }

  const tenants = await listActiveTenants();

  if (OPT_OUT_KEYWORDS.includes(body)) {
    // Revoke consent across all tenants for this phone
    for (const tenant of tenants) {
      try {
        await revokeSmsConsent(tenant.slug, fromPhone);
      } catch (error) {
        console.error(
          `[Twilio Inbound] Failed to revoke consent for ${tenant.slug}:`,
          error,
        );
      }
    }
    console.log(
      `[Twilio Inbound] Opt-out processed for ${fromPhone} across ${tenants.length} tenants`,
    );
  } else if (OPT_IN_KEYWORDS.includes(body)) {
    // Re-record consent for tenants where client exists with this phone
    for (const tenant of tenants) {
      try {
        const client = await withTenantDb(
          tenant.slug,
          async (db, { clients }) => {
            const [found] = await db
              .select({ id: clients.id })
              .from(clients)
              .where(eq(clients.phone, fromPhone))
              .limit(1);
            return found ?? null;
          },
        );

        if (client) {
          await recordSmsConsent(
            tenant.slug,
            client.id,
            fromPhone,
            "sms_keyword",
            "inbound_sms",
          );
        }
      } catch (error) {
        console.error(
          `[Twilio Inbound] Failed to record consent for ${tenant.slug}:`,
          error,
        );
      }
    }
    console.log(
      `[Twilio Inbound] Opt-in processed for ${fromPhone} across ${tenants.length} tenants`,
    );
  }

  // Return 200 with empty body — TwiML not needed for keyword responses
  // when Twilio Advanced Opt-Out handles auto-replies
  return new NextResponse(null, { status: 200 });
}
