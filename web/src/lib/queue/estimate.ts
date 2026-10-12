/**
 * Walk-in wait estimate. Pure: no I/O, no framework imports.
 *
 * A greedy simulation. Jobs are handled in order; each goes to the eligible
 * staff member who can start it earliest, and that time is carved out of their
 * free windows before the next job is placed.
 */
import { subtract } from "@/lib/scheduling/intervals";
import type { Interval } from "@/lib/scheduling/types";

const MIN = 60_000;

export type QueueStaff = { id: string; order: number; free: Interval[] };
/** `staffIds` is already filtered: a preferred person becomes `[id]`. */
export type QueueJob = { id: string; minutes: number; staffIds: string[] };
export type QueueEstimate = {
  id: string;
  staffId: string | null;
  start: Date | null;
  waitMinutes: number | null;
};

export function roundUpTo5(min: number): number {
  return Math.ceil(Math.max(0, min) / 5) * 5;
}

/** Mean of at least 3 samples, clamped to 5-480 minutes. Otherwise the fallback. */
export function pickServiceMinutes(samples: number[], fallback: number): number {
  if (samples.length < 3) return fallback;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return Math.min(480, Math.max(5, Math.round(mean)));
}

export function estimateQueue(now: Date, staff: QueueStaff[], jobs: QueueJob[]): QueueEstimate[] {
  const pool = staff.map((s) => ({
    id: s.id,
    order: s.order,
    free: s.free.map((w) => ({ start: new Date(w.start), end: new Date(w.end) })),
  }));
  const nowMs = now.getTime();
  const out: QueueEstimate[] = [];

  for (const job of jobs) {
    const lenMs = job.minutes * MIN;
    let best: { person: (typeof pool)[number]; startMs: number } | null = null;
    for (const person of pool) {
      if (!job.staffIds.includes(person.id)) continue;
      let found: number | null = null;
      for (const w of person.free) {
        const s = Math.max(w.start.getTime(), nowMs);
        if (s + lenMs <= w.end.getTime() && (found === null || s < found)) found = s;
      }
      if (found === null) continue;
      if (best === null || found < best.startMs || (found === best.startMs && person.order < best.person.order)) {
        best = { person, startMs: found };
      }
    }
    if (!best) {
      out.push({ id: job.id, staffId: null, start: null, waitMinutes: null });
      continue;
    }
    const cut: Interval = { start: new Date(best.startMs), end: new Date(best.startMs + lenMs) };
    best.person.free = best.person.free.flatMap((w) => subtract(w, [cut]));
    out.push({
      id: job.id,
      staffId: best.person.id,
      start: cut.start,
      waitMinutes: roundUpTo5((best.startMs - nowMs) / MIN),
    });
  }
  return out;
}
