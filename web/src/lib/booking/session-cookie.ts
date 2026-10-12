import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "booking_session";
// One year: clients (especially in the native app) verify once and stay
// signed in. The native app additionally re-sets the cookie on every launch
// via POST /api/push/register, so active users never expire.
const MAX_AGE = 365 * 24 * 60 * 60;

function getSecret(): string {
  const secret = process.env.BOOKING_SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BOOKING_SESSION_SECRET is required in production");
  }
  return secret || "dev-secret";
}

/**
 * Sign a payload string with HMAC-SHA256.
 * Returns `${payload}.${hmac_hex}`.
 */
function sign(payload: string): string {
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
  return `${payload}.${hmac}`;
}

/**
 * Verify a signed token.
 * Returns the payload if valid, null otherwise.
 */
function verify(token: string): string | null {
  const lastDot = token.lastIndexOf(".");
  if (lastDot === -1) return null;

  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);

  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");

  // Use timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (sigBuffer.length !== expectedBuffer.length) return null;
    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Set a booking session cookie for the given client ID.
 * Cookie is httpOnly, secure in production, sameSite lax, 1-year expiry.
 */
export async function setBookingSession(clientId: string): Promise<void> {
  const token = sign(clientId);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

/**
 * Get the client ID from the booking session cookie.
 * Returns null if no valid session exists.
 */
export async function getBookingSession(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  return verify(cookie.value);
}

/**
 * Clear the booking session cookie.
 */
export async function clearBookingSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
