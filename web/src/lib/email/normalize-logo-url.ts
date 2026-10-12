import { getBaseUrl } from "@/lib/utils";

/**
 * Prepare a logo URL for use in HTML email (`<img src>`).
 * Returns null when the value is empty, not loadable in typical mail clients,
 * or cannot be turned into an absolute https URL.
 */
export function normalizeLogoUrlForEmail(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  let u = raw.trim();
  if (!u) return null;

  // HEIC/HEIF are not reliably rendered inside email clients.
  const lower = u.split("?")[0]?.toLowerCase() ?? "";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) {
    return null;
  }

  if (u.startsWith("//")) {
    u = `https:${u}`;
  } else if (u.startsWith("/")) {
    const base = getBaseUrl().replace(/\/$/, "");
    u = `${base}${u}`;
  }

  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
