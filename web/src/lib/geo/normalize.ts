/** Pure postal-code normalization; safe to import from client components. */
/** US: the first 5 digits ("10001-1234" -> "10001"). Others: uppercase, no spaces. */
export function normalizePostal(code: string, country = "US"): string {
  const trimmed = code.trim();
  if (country.toUpperCase() === "US") {
    const m = trimmed.match(/^\d{5}/);
    return m ? m[0] : trimmed;
  }
  return trimmed.toUpperCase().replace(/\s+/g, "");
}
