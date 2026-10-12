/**
 * Canonicalize a phone number so the same human number always stores and
 * compares identically — this is what makes the `clients_phone_unique` index
 * and our find-by-phone lookups actually dedupe across formats like
 * "(555) 123-4567", "555-123-4567", "5551234567" and "+1 555 123 4567".
 *
 * For North American (NANP) numbers we return strict E.164 ("+15551234567"),
 * which is also the format Twilio expects. Numbers that already carry a "+"
 * country code are kept as-is (digits only). Anything else falls back to its
 * digits so we never block a save — but returns null when there are too few
 * digits to be a real phone number (matches the validator's 7-digit floor).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hadPlus = raw.trimStart().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;

  // US/Canada: 10-digit national, or 11-digit with the "1" country code.
  if (!hadPlus && digits.length === 10) return `+1${digits}`;
  if (!hadPlus && digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  // Already international (explicit "+"), or 11-digit "1" form with a plus.
  if (hadPlus) return `+${digits}`;

  // Unknown national format we can't safely attach a country code to — keep the
  // digits so it still saves and dedupes consistently against itself.
  return digits;
}

/** True when two raw phone inputs refer to the same canonical number. */
export function phonesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na !== null && na === nb;
}
