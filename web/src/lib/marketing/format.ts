/** "$12", or "$33.05" when there are cents. */
export function formatDollars(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

type Translate = (key: string, values: { hours?: number; minutes?: number }) => string;

/** Uses the `marketing.duration.*` messages: "45 min", "4 hr", "1 hr 30 min". */
export function formatDuration(t: Translate, total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return t("duration.minutes", { minutes });
  if (minutes === 0) return t("duration.hours", { hours });
  return t("duration.hoursMinutes", { hours, minutes });
}
