import { config } from "dotenv";

// Prefer .env.local (matches the rest of the repo). dotenv won't override
// anything already set in the environment.
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Standalone LoopMessage sandbox test — NOT wired into the live SMS path.
 * Lets you try LoopMessage before deciding to switch off Twilio.
 *
 * Env (set in .env.local, do NOT commit):
 *   LOOPMESSAGE_AUTH_KEY   (required) — Authorization key from the dashboard
 *   LOOPMESSAGE_SECRET_KEY (optional) — only if your account also issues a
 *                                       "Secret API Key" / Loop-Secret-Key
 *   LOOPMESSAGE_SENDER     (optional) — sender name; ignored for sandbox contacts
 *
 * Usage:
 *   cd web
 *   npx tsx scripts/test-loopmessage.ts "+15555550123" "Hello from Uptempo sandbox 👋"
 *
 * Sandbox prerequisite (from LoopMessage docs): the recipient must FIRST send an
 * iMessage to your sandbox sender, and be added to the sandbox contact list in
 * the dashboard. Otherwise you'll get "No conversation with sandbox contact".
 */
const ENDPOINT = "https://a.loopmessage.com/api/v1/message/send/";

async function main() {
  const authKey = process.env.LOOPMESSAGE_AUTH_KEY;
  if (!authKey) {
    console.error(
      "[loopmessage] Missing LOOPMESSAGE_AUTH_KEY. Add it to .env.local (from the LoopMessage dashboard).",
    );
    process.exit(1);
  }

  const contact = process.argv[2];
  const text =
    process.argv[3] ?? "Test message from the Uptempo LoopMessage sandbox.";
  if (!contact) {
    console.error(
      'Usage: npx tsx scripts/test-loopmessage.ts "<phone-or-imessage-email>" "<message text>"',
    );
    process.exit(1);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authKey,
  };
  // Some accounts also require a secret key header — send it only if provided.
  if (process.env.LOOPMESSAGE_SECRET_KEY) {
    headers["Loop-Secret-Key"] = process.env.LOOPMESSAGE_SECRET_KEY;
  }

  const body: Record<string, unknown> = {
    contact,
    text,
    // Correlate this send with any webhook callbacks you receive.
    passthrough: "uptempo-sandbox-test",
  };
  if (process.env.LOOPMESSAGE_SENDER) {
    body.sender = process.env.LOOPMESSAGE_SENDER; // ignored for sandbox contacts
  }

  console.log(`[loopmessage] POST ${ENDPOINT}`);
  console.log(`[loopmessage] contact=${contact}  text="${text}"`);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[loopmessage] Network error:", err);
    process.exit(1);
  }

  const raw = await res.text();
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* keep raw text */
  }

  console.log(`[loopmessage] HTTP ${res.status}`);
  console.dir(parsed, { depth: null });

  if (!res.ok) {
    console.error(
      "\n[loopmessage] Request failed. Common sandbox causes:\n" +
        '  • "No conversation with sandbox contact" → the recipient must iMessage\n' +
        "    your sandbox sender first and be on the sandbox contact list.\n" +
        "  • 401/403 → check LOOPMESSAGE_AUTH_KEY (and LOOPMESSAGE_SECRET_KEY).",
    );
    process.exit(1);
  }

  console.log("\n[loopmessage] Sent. Watch your device + the dashboard logs.");
  process.exit(0);
}

main();
