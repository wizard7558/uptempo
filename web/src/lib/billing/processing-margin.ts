/**
 * What Uptempo keeps on one card charge after Stripe's charge fee, the
 * Connect active-account fee, and payout fees. The reference profile is the
 * one used to pick 5% (D13). Amounts are cents and may be fractional when a
 * monthly fee is spread across charges.
 */
export type MarginProfile = {
  /** Average card ticket, in cents. */
  ticketCents: number;
  chargesPerMonth: number;
  /** Weekly payouts are about four a month. */
  payoutsPerMonth: number;
  /** Stripe's processing rate, as a fraction (0.029 is 2.9%). */
  stripeRate: number;
  stripeFixedCents: number;
  /** Connect active-account fee for the month, in cents. */
  connectMonthlyCents: number;
  /** Payout fee rate, as a fraction (0.0025 is 0.25%). */
  payoutRate: number;
  payoutFixedCents: number;
};

export const REFERENCE_PROFILE: MarginProfile = {
  ticketCents: 6000,
  chargesPerMonth: 40,
  payoutsPerMonth: 4,
  stripeRate: 0.029,
  stripeFixedCents: 30,
  connectMonthlyCents: 200,
  payoutRate: 0.0025,
  payoutFixedCents: 25,
};

export type ChargeMargin = {
  ticketCents: number;
  feeCollectedCents: number;
  stripeChargeFeeCents: number;
  payoutShareCents: number;
  connectShareCents: number;
  netCents: number;
  /** Net divided by the ticket. 0.012 is 1.2%. */
  netPercent: number;
};

export function processingMargin(
  profile: MarginProfile,
  rate: { rateBps: number; fixedCents: number },
  ticketCents: number = profile.ticketCents,
): ChargeMargin {
  const feeCollectedCents =
    Math.round((ticketCents * rate.rateBps) / 10_000) + rate.fixedCents;
  const stripeChargeFeeCents =
    Math.round(ticketCents * profile.stripeRate) + profile.stripeFixedCents;
  // Destination charge: the business is paid the ticket minus the application
  // fee, and the platform pays Stripe. Payout fees apply to that transfer.
  const paidOutCents = Math.max(0, ticketCents - feeCollectedCents);
  const payoutShareCents =
    profile.payoutRate * paidOutCents +
    (profile.payoutsPerMonth * profile.payoutFixedCents) /
      profile.chargesPerMonth;
  const connectShareCents =
    profile.connectMonthlyCents / profile.chargesPerMonth;
  const netCents =
    feeCollectedCents -
    stripeChargeFeeCents -
    payoutShareCents -
    connectShareCents;
  return {
    ticketCents,
    feeCollectedCents,
    stripeChargeFeeCents,
    payoutShareCents,
    connectShareCents,
    netCents,
    netPercent: ticketCents > 0 ? netCents / ticketCents : 0,
  };
}

/** Smallest ticket, in cents, whose net is at least zero. Null if none up to $1,000. */
export function breakEvenTicketCents(
  profile: MarginProfile,
  rate: { rateBps: number; fixedCents: number },
): number | null {
  return firstTicket(profile, rate, (margin) => margin.netCents >= 0);
}

/** Smallest ticket, in cents, whose net is at least `targetPercent` of the ticket. */
export function ticketForMarginCents(
  profile: MarginProfile,
  rate: { rateBps: number; fixedCents: number },
  targetPercent: number,
): number | null {
  return firstTicket(
    profile,
    rate,
    (margin) => margin.netPercent >= targetPercent,
  );
}

function firstTicket(
  profile: MarginProfile,
  rate: { rateBps: number; fixedCents: number },
  met: (margin: ChargeMargin) => boolean,
): number | null {
  for (let ticketCents = 1; ticketCents <= 100_000; ticketCents += 1) {
    if (met(processingMargin(profile, rate, ticketCents))) return ticketCents;
  }
  return null;
}
