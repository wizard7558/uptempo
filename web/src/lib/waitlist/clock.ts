import { TZDate } from "@date-fns/tz";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatBusinessDay(at: Date, tz: string): string {
  const z = new TZDate(at, tz);
  return `${WEEKDAYS[z.getDay()]}, ${MONTHS[z.getMonth()]} ${z.getDate()}`;
}

export function formatBusinessTime(at: Date, tz: string): string {
  const z = new TZDate(at, tz);
  const ap = z.getHours() >= 12 ? "PM" : "AM";
  let h = z.getHours() % 12;
  if (h === 0) h = 12;
  const m = String(z.getMinutes()).padStart(2, "0");
  return `${h}:${m} ${ap}`;
}

export function shortDay(ymd: string): string {
  const [, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}
