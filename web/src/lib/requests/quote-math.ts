export type QuoteMathLine = { quantity: number; unitCents: number; minutes: number };

/** Price is quantity x each; time is what the whole line takes, not per item. */
export function quoteTotals(lines: QuoteMathLine[]): { subtotalCents: number; minutes: number } {
  return {
    subtotalCents: lines.reduce((sum, l) => sum + l.quantity * l.unitCents, 0),
    minutes: lines.reduce((sum, l) => sum + l.minutes, 0),
  };
}

/** 30 -> "30 min", 240 -> "4 hr", 270 -> "4 hr 30 min". The words come from the caller (en.json). */
export function formatDuration(
  minutes: number,
  words: { min: (count: number) => string; hr: (count: number) => string },
): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return words.min(rest);
  return rest === 0 ? words.hr(hours) : `${words.hr(hours)} ${words.min(rest)}`;
}

/** Choices for a line's time: 15 minutes up to 10 hours. */
export const LINE_MINUTE_OPTIONS: number[] = Array.from({ length: 40 }, (_, i) => (i + 1) * 15);
