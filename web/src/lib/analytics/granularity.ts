import { differenceInDays } from "date-fns";

/**
 * Auto-select granularity based on date range length.
 * Under 14 days = "day", 14-90 days = "week", over 90 days = "month".
 */
export function autoGranularity(
  dateRange: { start: Date; end: Date },
): "day" | "week" | "month" {
  const days = differenceInDays(dateRange.end, dateRange.start);
  if (days < 14) return "day";
  if (days <= 90) return "week";
  return "month";
}
