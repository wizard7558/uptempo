"use client";

import { useEffect, useRef, useState } from "react";

const MAX_BACKOFF_MS = 60_000;

/**
 * Poll `load` every `intervalMs`. Runs immediately, then schedules with
 * setTimeout. Skips ticks while the page is hidden and reloads when it becomes
 * visible. After an error the delay doubles (max 60s) and resets on success.
 * Stops once `stop(data)` returns true.
 */
export function usePolling<T>(
  load: () => Promise<T>,
  opts: { intervalMs: number; stop?: (v: T) => boolean },
): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const loadRef = useRef(load);
  const stopRef = useRef(opts.stop);
  useEffect(() => {
    loadRef.current = load;
    stopRef.current = opts.stop;
  });

  const { intervalMs } = opts;
  useEffect(() => {
    let cancelled = false;
    let done = false;
    let running = false;
    let delay = intervalMs;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelled || done) return;
      clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };

    async function tick() {
      if (cancelled || done || running) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      running = true;
      try {
        const v = await loadRef.current();
        if (cancelled) return;
        setData(v);
        setError(false);
        delay = intervalMs;
        if (stopRef.current?.(v)) done = true;
      } catch {
        if (cancelled) return;
        setError(true);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      } finally {
        running = false;
      }
      schedule();
    }

    const onVisible = () => {
      if (document.visibilityState === "visible" && !done) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return { data, error };
}
