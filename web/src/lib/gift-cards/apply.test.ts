import { describe, expect, it } from "vitest";
import { planGiftCardApplication } from "./apply";

describe("planGiftCardApplication", () => {
  it("uses the card after the prepaid balance and the deposit, and leaves the rest", () => {
    expect(planGiftCardApplication({
      totalWithTipCents: 12000,
      prepaidAppliedCents: 3000,
      depositPaidCents: 1500,
      giftBalanceCents: 5000,
      requestedCents: null,
    })).toEqual({ dueBeforeGiftCents: 7500, giftAppliedCents: 5000, remainderCents: 2500 });
  });

  it("stops at what is still owed when the card is larger", () => {
    expect(planGiftCardApplication({
      totalWithTipCents: 12000,
      prepaidAppliedCents: 3000,
      depositPaidCents: 1500,
      giftBalanceCents: 8000,
      requestedCents: null,
    })).toEqual({ dueBeforeGiftCents: 7500, giftAppliedCents: 7500, remainderCents: 0 });
  });

  it("uses only the amount the caller asked for", () => {
    expect(planGiftCardApplication({
      totalWithTipCents: 5000,
      prepaidAppliedCents: 0,
      depositPaidCents: 0,
      giftBalanceCents: 8000,
      requestedCents: 2000,
    })).toEqual({ dueBeforeGiftCents: 5000, giftAppliedCents: 2000, remainderCents: 3000 });
  });

  it("applies nothing when the visit is already covered", () => {
    expect(planGiftCardApplication({
      totalWithTipCents: 5000,
      prepaidAppliedCents: 6000,
      depositPaidCents: 0,
      giftBalanceCents: 1000,
      requestedCents: null,
    })).toEqual({ dueBeforeGiftCents: 0, giftAppliedCents: 0, remainderCents: 0 });
  });
});
