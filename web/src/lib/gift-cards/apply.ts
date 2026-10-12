/**
 * How much of a checkout a gift card covers, after the deposit and the prepaid
 * balance. The card may cover the tip. A null request means "use the card up
 * to what is still owed".
 */
export function planGiftCardApplication(p: {
  totalWithTipCents: number;
  prepaidAppliedCents: number;
  depositPaidCents: number;
  giftBalanceCents: number;
  requestedCents: number | null;
}): { dueBeforeGiftCents: number; giftAppliedCents: number; remainderCents: number } {
  const dueBeforeGiftCents = Math.max(
    0,
    p.totalWithTipCents - p.prepaidAppliedCents - p.depositPaidCents,
  );
  const wanted = p.requestedCents == null ? p.giftBalanceCents : Math.max(0, p.requestedCents);
  const giftAppliedCents = Math.min(wanted, Math.max(0, p.giftBalanceCents), dueBeforeGiftCents);
  return {
    dueBeforeGiftCents,
    giftAppliedCents,
    remainderCents: dueBeforeGiftCents - giftAppliedCents,
  };
}
