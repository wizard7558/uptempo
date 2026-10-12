const DEFAULT_LOCALE = "en-US";

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone });
    return true;
  } catch {
    return false;
  }
}
