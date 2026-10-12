import { createHmac, randomBytes } from "crypto";

/**
 * OAuth state token generation and validation for calendar connections.
 * Embeds stylistId and platform with HMAC integrity protection.
 */

const STATE_SECRET =
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "fallback-dev-secret";
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minute expiry

import type { NativeApp } from "@/lib/native/return";

/**
 * Build the signed payload. The `native` app marker is only appended when
 * present, so web flows (native omitted) produce the exact same signature as
 * before — keeping any in-flight web OAuth tokens valid across deploy.
 */
function statePayload(
  staffId: string,
  platform: string,
  nonce: string,
  ts: number,
  native?: NativeApp,
): string {
  const base = `${staffId}:${platform}:${nonce}:${ts}`;
  return native ? `${base}:${native}` : base;
}

export function generateOAuthState(
  staffId: string,
  platform: string,
  native?: NativeApp,
): string {
  const nonce = randomBytes(16).toString("hex");
  const ts = Date.now();
  const payload = statePayload(staffId, platform, nonce, ts, native);
  const sig = createHmac("sha256", STATE_SECRET)
    .update(payload)
    .digest("base64url");

  const state = Buffer.from(
    JSON.stringify({ staffId, platform, nonce, ts, sig, native }),
  ).toString("base64url");

  return state;
}

export function validateOAuthState(
  state: string,
): { staffId: string; platform: string; native?: NativeApp } | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8"),
    );
    const { platform, nonce, ts, sig, native } = decoded;
    // `stylistId`: states minted before Phase 1.5 (10-minute TTL). Remove after this release.
    const staffId: string | undefined = decoded.staffId ?? decoded.stylistId;

    if (!staffId || !platform || !nonce || !ts || !sig) return null;

    // Check expiry
    if (Date.now() - ts > STATE_TTL_MS) return null;

    const safeNative: NativeApp | undefined =
      native === "owner" || native === "client" ? native : undefined;

    // Verify HMAC
    const payload = statePayload(staffId, platform, nonce, ts, safeNative);
    const expected = createHmac("sha256", STATE_SECRET)
      .update(payload)
      .digest("base64url");

    if (sig !== expected) return null;

    return { staffId, platform, native: safeNative };
  } catch {
    return null;
  }
}
