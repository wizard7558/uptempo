/** Largest monthly contribution we'll accept ($100k), as a sanity ceiling. */
export const MAX_CONTRIBUTION_CENTS = 100_000_00;

/**
 * Validates a client-chosen custom monthly contribution against a plan.
 * Returns an error message, or null when the amount is acceptable.
 *
 * Server-side guard (defense in depth): the public UI also validates, but the
 * floor and gating must never be trusted from the client.
 */
export function customAmountError(
  plan: {
    allowCustomAmount: number;
    monthlyAmountCents: number;
    stripeProductId: string | null;
  },
  customAmountCents: number,
): string | null {
  if (plan.allowCustomAmount !== 1) {
    return "Custom amounts are not enabled for this plan";
  }
  if (!Number.isInteger(customAmountCents) || customAmountCents % 100 !== 0) {
    return "Amount must be a whole dollar value";
  }
  if (customAmountCents < plan.monthlyAmountCents) {
    return `Minimum is $${Math.round(plan.monthlyAmountCents / 100)}/mo`;
  }
  if (customAmountCents > MAX_CONTRIBUTION_CENTS) {
    return "Amount is too large";
  }
  if (!plan.stripeProductId) {
    return "Plan has no Stripe product";
  }
  return null;
}
