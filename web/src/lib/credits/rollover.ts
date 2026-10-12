/**
 * What happens to a membership's credits when a new paid period starts:
 * anything above `rolloverMax` expires, then `perPeriod` new credits are granted.
 */
export function periodRollover(
  remaining: number,
  rolloverMax: number,
  perPeriod: number,
): { expire: number; grant: number } {
  return { expire: Math.max(0, remaining - rolloverMax), grant: perPeriod };
}
