/**
 * Shared, dependency-free email helpers.
 *
 * Deliberately a plain module (not a `"use server"` file and not zod) so both
 * client components and server actions can import it — the post-quiz waitlist
 * prompt needs the same answer on both sides, otherwise the UI offers a
 * one-tap "Yes" that the server then rejects.
 */

/** Same shape as `src/actions/team.ts` — good enough to catch typos, not RFC 5322. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Longest email we store (matches the `email` column width). */
export const EMAIL_MAX_LENGTH = 320;

/**
 * Normalize an address for storage and comparison: trimmed, lowercased, capped.
 * Returns null when the input isn't a plausible address, so callers can treat
 * "absent" and "malformed" identically.
 */
export function normalizeEmail(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, EMAIL_MAX_LENGTH).toLowerCase();
  if (!trimmed || !EMAIL_REGEX.test(trimmed)) return null;
  return trimmed;
}

/** True when `value` looks like an address we could actually send to. */
export function isLikelyEmail(value: string | undefined | null): boolean {
  return normalizeEmail(value) !== null;
}

/**
 * Parse a comma-separated recipient list (as used by the `*_NOTIFY_EMAIL` env
 * vars) into deduped, validated addresses.
 *
 * Malformed entries are dropped rather than failing the whole list: these feed
 * best-effort internal notifications, and one fat-fingered address in Vercel
 * shouldn't silently stop the other recipients from being told.
 */
export function parseEmailList(value: string | undefined | null): string[] {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const email = normalizeEmail(part);
    if (email) seen.add(email);
  }
  return [...seen];
}
