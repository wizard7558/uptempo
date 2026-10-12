import { planGiftCardApplication } from "@/lib/gift-cards/apply";

/**
 * The one calculation of what a checkout charges, shared by the checkout
 * dialog, `createCheckoutPaymentIntent` and `completeAppointment`. The
 * PaymentIntent amount must equal the remainder `completeAppointment` expects,
 * so none of them may work these numbers out on their own.
 *
 * Order: deposit, then prepaid balance (services only), then gift card (which
 * may cover the tip), then card or cash for the rest.
 *
 * Two ways to pay the prepaid balance:
 * - Paying the whole visit from it: the member discounted services total comes off.
 * - Anything else: the balance covers up to the undiscounted services total.
 *
 * The tip is always on top and is never covered by the prepaid balance. The
 * deposit credit (already resolved by `resolveDepositToApply`) comes off what
 * is left, and the remainder never goes below zero.
 *
 * A visit covered by a credit (`creditCovered`) costs nothing for the services:
 * no prepaid balance and no deposit are applied, and only the tip is left.
 * A gift card can still pay that tip.
 */
export type CheckoutAmountsInput = {
  payingFullFromPrepaid: boolean;
  totalCents: number;
  tipCents: number;
  /** Prepaid balance applied when not paying fully from it: min(balance, totalCents). */
  partialBankAppliedCents: number;
  /** Services total after the member discount, applied when paying fully from the balance. */
  discountedTotalCents: number;
  depositAppliedCents: number;
  /** A package or membership credit already paid for this visit's services. */
  creditCovered?: boolean;
  /** Omit (or pass 0) when no gift card is applied. */
  giftBalanceCents?: number;
  /** Null means use as much of the card as the visit still needs. */
  giftRequestedCents?: number | null;
};

export type CheckoutAmounts = {
  totalWithTip: number;
  bankAppliedCents: number;
  depositAppliedCents: number;
  giftAppliedCents: number;
  /** What the card (or cash) still owes. Zero means no charge and no PaymentIntent. */
  remainderCents: number;
};

export function computeCheckoutAmounts(i: CheckoutAmountsInput): CheckoutAmounts {
  const giftBalanceCents = i.giftBalanceCents ?? 0;
  const giftRequestedCents = i.giftRequestedCents === undefined ? null : i.giftRequestedCents;
  if (i.creditCovered) {
    const gift = planGiftCardApplication({
      totalWithTipCents: i.tipCents,
      prepaidAppliedCents: 0,
      depositPaidCents: 0,
      giftBalanceCents,
      requestedCents: giftRequestedCents,
    });
    return {
      totalWithTip: i.tipCents,
      bankAppliedCents: 0,
      depositAppliedCents: 0,
      giftAppliedCents: gift.giftAppliedCents,
      remainderCents: gift.remainderCents,
    };
  }
  const bankAppliedCents = i.payingFullFromPrepaid ? i.discountedTotalCents : i.partialBankAppliedCents;
  const totalWithTip = (i.payingFullFromPrepaid ? i.discountedTotalCents : i.totalCents) + i.tipCents;
  const depositAppliedCents = i.depositAppliedCents;
  const gift = planGiftCardApplication({
    totalWithTipCents: totalWithTip,
    prepaidAppliedCents: bankAppliedCents,
    depositPaidCents: depositAppliedCents,
    giftBalanceCents,
    requestedCents: giftRequestedCents,
  });
  return {
    totalWithTip,
    bankAppliedCents,
    depositAppliedCents,
    giftAppliedCents: gift.giftAppliedCents,
    remainderCents: gift.remainderCents,
  };
}
