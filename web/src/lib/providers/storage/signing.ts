import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.BOOKING_SESSION_SECRET;
  if (!s) throw new Error("BOOKING_SESSION_SECRET is required to sign private file URLs");
  return s;
}

function mac(key: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${key}\n${exp}`).digest("hex");
}

export function signPrivateKey(key: string, ttlSeconds: number, now = Date.now()) {
  const exp = Math.floor(now / 1000) + Math.max(1, Math.floor(ttlSeconds));
  return { exp, sig: mac(key, exp) };
}

/** True only for an unexpired exp with a matching signature. */
export function verifyPrivateKey(
  key: string,
  expRaw: string | null,
  sig: string | null,
  now = Date.now(),
): boolean {
  if (!expRaw || !sig || !/^\d+$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  if (exp * 1000 <= now) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(mac(key, exp), "hex");
  } catch {
    return false;
  }
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
