/** Beauty Bank + optional member discount when paying fully from BB (exported for tests). */
export type StoredValueCheckoutPreview = {
  balanceCents: number;
  hasActiveMembership: boolean;
  memberDiscountPercent: number;
  totalCents: number;
  /** Services total after member discount (same as totalCents when not eligible for discount). */
  discountedTotalCents: number;
  /** Member with enough balance to pay discounted services total from BB (tip must be 0 to use). */
  eligibleForFullBb: boolean;
  /** BB applied when not using full-BB path (min(balance, undiscounted total)). */
  partialBbAppliedCents: number;
  cardChargeCentsPartial: number;
};

export function buildStoredValueCheckoutPreview(
  balanceCents: number,
  totalCents: number,
  memberDiscountPercent: number,
  hasActiveMembership: boolean,
): StoredValueCheckoutPreview {
  const pct = Math.min(100, Math.max(0, Math.round(memberDiscountPercent)));
  const discountCents =
    hasActiveMembership && pct > 0
      ? Math.round((totalCents * pct) / 100)
      : 0;
  const discountedTotalCents = Math.max(0, totalCents - discountCents);
  const partialBbAppliedCents = Math.min(balanceCents, totalCents);
  const cardChargeCentsPartial = totalCents - partialBbAppliedCents;
  const eligibleForFullBb =
    hasActiveMembership &&
    discountedTotalCents > 0 &&
    balanceCents >= discountedTotalCents;
  return {
    balanceCents,
    hasActiveMembership,
    memberDiscountPercent: pct,
    totalCents,
    discountedTotalCents,
    eligibleForFullBb,
    partialBbAppliedCents,
    cardChargeCentsPartial,
  };
}
