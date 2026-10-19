/**
 * Shared helpers for displaying business / appointment location in UI and emails.
 */

/** Join location name and address; use fallback when both are empty. */
export function formatLocationLines(
  name?: string | null,
  address?: string | null,
  fallback?: string | null,
): string | null {
  const parts = [name, address].filter((value): value is string => Boolean(value));
  if (parts.length > 0) {
    return parts.join(" - ");
  }
  return fallback ?? null;
}

/** Same as {@link formatLocationLines} but accepts a location object (e.g. joined query). */
export function formatLocationFromObject(
  location:
    | {
        name?: string | null;
        address?: string | null;
      }
    | null
    | undefined,
  fallback?: string | null,
): string | null {
  return formatLocationLines(location?.name, location?.address, fallback);
}
