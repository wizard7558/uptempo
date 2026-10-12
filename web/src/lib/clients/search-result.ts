export interface ClientSearchRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface ClientSearchResult {
  id: string;
  name: string;
  /** Best available secondary identifier: email, else phone, else empty. */
  subtitle: string;
}

/**
 * Maps a raw client row to the compact shape the global search renders.
 * Prefers email as the subtitle and falls back to phone; never leaks nulls.
 */
export function toClientSearchResult(row: ClientSearchRow): ClientSearchResult {
  const subtitle = row.email?.trim() || row.phone?.trim() || "";
  return { id: row.id, name: row.name, subtitle };
}
