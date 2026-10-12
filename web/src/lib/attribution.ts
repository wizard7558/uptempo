/**
 * Attribution labels for the public `/quiz` and `/waitlist` pages.
 *
 * QR codes and campaign links carry `?src=<label>` (see
 * `scripts/generate-qr-codes.mjs`). The label lands in a URL, a printed QR, and
 * a database column, so it is normalized to a narrow slug on both ends: the
 * generator refuses labels that would change under `cleanSource`, and the
 * server actions run every inbound value through it before persisting.
 */

/** Max stored length of a source label. */
export const SOURCE_MAX_LENGTH = 64;

/**
 * Normalize a `?src=` value into a lowercase slug (`a-z`, `0-9`, `-`), or null
 * if it is absent or has no usable characters. Anything else — spaces,
 * punctuation, unicode — collapses to `-`, which keeps hand-typed and
 * mis-scanned values from fragmenting the reporting.
 */
export function cleanSource(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SOURCE_MAX_LENGTH)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : null;
}

/**
 * Label for a waitlist signup that came from the post-quiz prompt rather than
 * a direct `/waitlist` visit.
 *
 * Prefixing preserves the original placement — someone who scanned the chair
 * card, did the quiz, then opted in becomes `quiz-chair`, which is a materially
 * different (and much warmer) signal than a cold `chair` scan on `/waitlist`.
 * Re-normalized so the `quiz-` prefix can't push the label past the column cap
 * or leave a trailing hyphen.
 */
export function viaQuizSource(source: string | null | undefined): string {
  const base = cleanSource(source);
  return cleanSource(base ? `quiz-${base}` : "quiz") ?? "quiz";
}

/**
 * Read a `?src=` label out of Next's resolved `searchParams`. Repeated params
 * arrive as an array; only the first is considered.
 */
export function sourceFromSearchParams(
  params: Record<string, string | string[] | undefined> | undefined,
): string | null {
  const raw = params?.src;
  return cleanSource(Array.isArray(raw) ? raw[0] : raw);
}
