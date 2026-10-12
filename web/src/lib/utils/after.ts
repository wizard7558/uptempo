import { after } from "next/server";

/**
 * Run work after the response is sent. Outside a request scope `after` throws,
 * so fall back to running the work immediately (fire and forget). Errors are
 * logged, never thrown.
 */
export function runAfterResponse(fn: () => Promise<unknown>): void {
  const log = (err: unknown) => console.error("[after] background task failed:", err);
  try {
    after(() => fn().catch(log));
  } catch {
    void fn().catch(log);
  }
}
