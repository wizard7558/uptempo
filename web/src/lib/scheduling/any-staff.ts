/**
 * "Anyone available": from every candidate's slots, keep one slot per start time.
 * Pure: no I/O.
 */
import type { Slot } from "./types";

/**
 * One slot per start. A regular slot beats a flex slot (a flex slot is a
 * double-booking inside someone else's appointment); then the person with the
 * fewest appointments that day wins; then the earlier person in `staffOrder`
 * (display-name order). Staff missing from `staffOrder` sort last. Output is
 * sorted by start.
 */
export function pickLeastLoaded(
  slots: Slot[],
  staffOrder: string[],
  dayLoad: Record<string, number>,
): Slot[] {
  const rank = (id: string) => {
    const i = staffOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const beats = (a: Slot, b: Slot): boolean => {
    if (a.isFlex !== b.isFlex) return !a.isFlex;
    const la = dayLoad[a.staffId] ?? 0;
    const lb = dayLoad[b.staffId] ?? 0;
    if (la !== lb) return la < lb;
    return rank(a.staffId) < rank(b.staffId);
  };
  const best = new Map<number, Slot>();
  for (const s of slots) {
    const key = s.start.getTime();
    const cur = best.get(key);
    if (!cur || beats(s, cur)) best.set(key, s);
  }
  return [...best.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
}
