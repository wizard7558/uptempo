/** Tip in cents from a percentage of service subtotal (before stored value). */
export function percentTipCents(serviceSubtotalCents: number, pct: number): number {
  return Math.round((serviceSubtotalCents * pct) / 100);
}
