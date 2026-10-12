import { addDays } from "date-fns";
import { TZDate } from "@date-fns/tz";

/** Must match salon policies / booking-public test tenant timezone. */
export const E2E_SALON_TZ = "America/New_York";

export type FlexHostDay = {
  hostStart: Date;
  hostEnd: Date;
  /** Selects `[data-booking-date="${dateYmd}"]` on the time step. */
  dateYmd: string;
};

function pushHostDayForProbe(probe: TZDate, results: FlexHostDay[]) {
  const dow = probe.getDay();
  if (dow === 0) return;

  const openHour = dow === 6 ? 10 : 9;
  const start = new TZDate(
    probe.getFullYear(),
    probe.getMonth(),
    probe.getDate(),
    openHour,
    0,
    0,
    0,
    E2E_SALON_TZ,
  );
  const hostStart = new Date(start.getTime());
  const hostEnd = new Date(hostStart.getTime() + 75 * 60 * 1000);

  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, "0");
  const d = String(start.getDate()).padStart(2, "0");

  results.push({ hostStart, hostEnd, dateYmd: `${y}-${m}-${d}` });
}

/**
 * Next N Mon–Sat salon days (skips Sunday) with the E2E working-hours pattern.
 * Seed inserts a host appointment on each; Playwright scans these `dateYmd`
 * values until it finds a flex slot so runs stay stable across days without
 * re-seeding.
 */
export function enumerateFlexHostSeedDays(
  count = 14,
  now = new Date(),
): FlexHostDay[] {
  const results: FlexHostDay[] = [];
  const base = new TZDate(now, E2E_SALON_TZ);

  for (let i = 1; i <= 60 && results.length < count; i++) {
    const probe = new TZDate(addDays(base, i), E2E_SALON_TZ);
    pushHostDayForProbe(probe, results);
  }

  if (results.length < count) {
    throw new Error(
      `[E2E] Need ${count} flex host seed days but only found ${results.length}`,
    );
  }

  return results;
}

/** First eligible host day (used when only one block is needed). */
export function getNextFlexHostContext(now = new Date()): FlexHostDay {
  const [first] = enumerateFlexHostSeedDays(1, now);
  if (!first) {
    throw new Error("[E2E] No flex host day found within search window");
  }
  return first;
}
