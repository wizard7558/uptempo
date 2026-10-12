interface FeeCalculation {
  feeCents: number;
  basePriceCents: number;
  feePercent: number;
  reason: "late_cancellation" | "no_show";
}

/**
 * Calculate a policy fee based on the base price and fee percentage.
 * All arithmetic uses integer cents to avoid floating-point issues.
 */
export function calculateFee(
  basePriceCents: number,
  feePercent: number,
  reason: "late_cancellation" | "no_show",
): FeeCalculation {
  const feeCents = Math.round(basePriceCents * (feePercent / 100));
  return { feeCents, basePriceCents, feePercent, reason };
}

/**
 * Check whether the current time is within the cancellation window
 * for a given appointment start time.
 * Within window = appointment is less than windowHours away (and in the future).
 */
export function isWithinCancellationWindow(
  appointmentStart: Date,
  windowHours: number,
): boolean {
  const windowMs = windowHours * 60 * 60 * 1000;
  const now = new Date();
  const timeUntilAppointment = appointmentStart.getTime() - now.getTime();
  return timeUntilAppointment > 0 && timeUntilAppointment < windowMs;
}

/**
 * Calculate total appointment price from service prices.
 * Uses priceChargedCents (snapshot at booking time) if available,
 * falls back to current priceCents.
 */
export function calculateAppointmentPrice(
  services: { priceChargedCents: number | null; priceCents: number | null }[],
): number {
  return services.reduce((total, svc) => {
    const price = svc.priceChargedCents ?? svc.priceCents ?? 0;
    return total + price;
  }, 0);
}
