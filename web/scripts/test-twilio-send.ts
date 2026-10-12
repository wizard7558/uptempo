import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * One-off Twilio test send through the configured Messaging Service.
 * Usage: cd web && npx tsx scripts/test-twilio-send.ts "+1XXXXXXXXXX" "message"
 */
async function main() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) {
    console.error("[twilio] Missing TWILIO_* env vars in .env.local");
    process.exit(1);
  }

  const to = process.argv[2];
  const body =
    process.argv[3] ??
    "Uptempo test: your appointment reminders are working. Reply STOP to opt out.";
  if (!to) {
    console.error('Usage: npx tsx scripts/test-twilio-send.ts "+1XXXXXXXXXX" "message"');
    process.exit(1);
  }

  const { default: twilio } = await import("twilio");
  const client = twilio(accountSid, authToken);

  try {
    const msg = await client.messages.create({
      to,
      body,
      messagingServiceSid: serviceSid,
    });
    console.log(`[twilio] queued: sid=${msg.sid} status=${msg.status}`);
    console.log("[twilio] Watch the phone + Twilio console > Monitor > Logs.");
  } catch (err) {
    const e = err as { message?: string; code?: number; moreInfo?: string };
    console.error(`[twilio] FAILED: ${e.message} (code ${e.code})`);
    if (e.moreInfo) console.error(`  ${e.moreInfo}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
