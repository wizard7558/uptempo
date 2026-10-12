import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, tamper-proof links to private attachments.
 *
 * A link never contains a storage URL. It names the tenant and attachment, and
 * carries an expiry plus an HMAC over `slug:id:exp`. The route re-checks the
 * link, loads the attachment row, applies staff-only rules, and only then asks
 * the storage provider for a read URL that lives for about a minute.
 */
export const FILE_LINK_ROUTE = "/api/attachments";
export const DEFAULT_FILE_LINK_TTL_SECONDS = 300;

function secret(): string {
  const s = process.env.FILE_LINK_SECRET || process.env.BOOKING_SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("FILE_LINK_SECRET or BOOKING_SESSION_SECRET is required in production");
  }
  return s || "dev-secret";
}

function mac(slug: string, id: string, exp: string): string {
  return createHmac("sha256", secret()).update(`${slug}:${id}:${exp}`).digest("base64url");
}

export function signFileLink(
  slug: string,
  attachmentId: string,
  ttlSeconds = DEFAULT_FILE_LINK_TTL_SECONDS,
  now = Date.now(),
): string {
  const exp = String(Math.floor(now / 1000) + Math.max(1, Math.floor(ttlSeconds)));
  const s = mac(slug, attachmentId, exp);
  return `${FILE_LINK_ROUTE}/${encodeURIComponent(slug)}/${encodeURIComponent(attachmentId)}?e=${exp}&s=${s}`;
}

export function verifyFileLink(
  slug: string,
  id: string,
  e: string | null,
  s: string | null,
  now = Date.now(),
): boolean {
  if (!e || !s || !/^\d{1,12}$/.test(e)) return false;
  if (Number(e) * 1000 <= now) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(mac(slug, id, e));
  } catch {
    return false;
  }
  const given = Buffer.from(s);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
