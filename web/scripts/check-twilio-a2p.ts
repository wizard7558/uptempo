import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Read-only Twilio A2P readiness check. Confirms the Messaging Service exists,
 * how many phone numbers are in its sender pool, and the status of the A2P
 * 10DLC campaign attached to it. Sending only works once a campaign is approved
 * and a number is in the pool.
 *
 * Usage: cd web && npx tsx scripts/check-twilio-a2p.ts
 */
async function main() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !serviceSid) {
    console.error(
      "[twilio] Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID in .env.local",
    );
    process.exit(1);
  }

  const { default: twilio } = await import("twilio");
  const client = twilio(accountSid, authToken);
  const svc = client.messaging.v1.services(serviceSid);

  // 1) Messaging Service
  try {
    const service = await svc.fetch();
    console.log("Messaging Service");
    console.log(`  sid:           ${service.sid}`);
    console.log(`  name:          ${service.friendlyName}`);
    console.log(`  status cb:     ${service.statusCallback ?? "(none)"}`);
  } catch (err) {
    console.error(
      `[twilio] Could not fetch Messaging Service ${serviceSid}: ${
        err instanceof Error ? err.message : err
      }`,
    );
    process.exit(1);
  }

  // 2) Sender pool (phone numbers)
  try {
    const numbers = await svc.phoneNumbers.list({ limit: 50 });
    console.log(`\nSender pool: ${numbers.length} number(s)`);
    for (const n of numbers) {
      console.log(`  • ${n.phoneNumber} (${n.sid})`);
    }
    if (numbers.length === 0) {
      console.log("  ⚠️  No numbers — add one to the Messaging Service to send.");
    }
  } catch (err) {
    console.error(
      `[twilio] Could not list phone numbers: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  // 3) A2P 10DLC campaign attached to this Messaging Service
  try {
    const campaigns = await svc.usAppToPerson.list({ limit: 5 });
    console.log(`\nA2P 10DLC campaign(s): ${campaigns.length}`);
    if (campaigns.length === 0) {
      console.log(
        "  ⚠️  No campaign attached to this Messaging Service — US carriers will block traffic.",
      );
    }
    for (const c of campaigns) {
      console.log(`  • sid:            ${c.sid}`);
      console.log(`    campaignStatus: ${c.campaignStatus}`);
      console.log(`    usecase:        ${c.usAppToPersonUsecase}`);
      console.log(`    brand:          ${c.brandRegistrationSid}`);
      const approved = String(c.campaignStatus).toUpperCase() === "VERIFIED";
      console.log(
        approved
          ? "    ✅ Approved — ready to send."
          : `    ⏳ Not approved yet (status: ${c.campaignStatus}).`,
      );
    }
  } catch (err) {
    console.error(
      `[twilio] Could not list A2P campaigns: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  process.exit(0);
}

main();
