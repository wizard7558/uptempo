import crypto from "crypto";

/** 192-bit unguessable token for public (unauthenticated) links. 32 chars. */
export function newPublicToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/** SHA-256 hex digest (64 chars). Store this, never the raw token. */
export function hashPublicToken(t: string): string {
  return crypto.createHash("sha256").update(t).digest("hex");
}

/** True when the string looks like a token from newPublicToken(). */
export function isPublicTokenShape(t: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(t);
}

/** Constant-time compare of two hex strings. False (never throws) on a length
 * mismatch or non-hex input. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length % 2 !== 0) return false;
  if (!/^[0-9a-fA-F]*$/.test(a) || !/^[0-9a-fA-F]*$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
