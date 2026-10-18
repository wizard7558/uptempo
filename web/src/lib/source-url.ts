export const DEFAULT_SOURCE_URL = "https://github.com/wizard7558/uptempo";

export function sourceUrl(): string {
  return process.env.UPTEMPO_SOURCE_URL?.trim() || DEFAULT_SOURCE_URL;
}
