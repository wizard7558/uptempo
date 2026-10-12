import crypto from "crypto";

/** Crockford base32. I, L, O and U are left out so a handwritten code stays readable. */
export const GIFT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const NORMALIZED = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/**
 * 16 characters, 80 bits. Each byte is masked to 5 bits. 256 divides evenly
 * by 32, so the mask does not bias any letter.
 */
export function generateGiftCardCode(): string {
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (const byte of bytes) out += GIFT_CODE_ALPHABET[byte & 31];
  return out;
}

/** Uppercase, drop spaces and dashes, then map O→0, I→1, L→1. Null when it is not 16 Crockford characters. */
export function normalizeGiftCardCode(raw: string): string | null {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return NORMALIZED.test(cleaned) ? cleaned : null;
}

export function formatGiftCardCode(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}`;
}

export function giftCardLast4(normalized: string): string {
  return normalized.slice(-4);
}

export function hashGiftCardCode(normalized: string): string {
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
