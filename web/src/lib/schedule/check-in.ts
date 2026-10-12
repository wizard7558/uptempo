/** The first check-in time sticks. A second call keeps that time. */
export function applyCheckIn(
  existing: Date | null,
  now: Date,
): { at: Date; changed: boolean } {
  if (existing) return { at: existing, changed: false };
  return { at: now, changed: true };
}
