import { describe, expect, it } from "vitest";
import { computeCheckoutAmounts, type CheckoutAmountsInput } from "./due-now";

const base: CheckoutAmountsInput = {
  payingFullFromPrepaid: false,
  totalCents: 40000,
  tipCents: 0,
  partialBankAppliedCents: 0,
  discountedTotalCents: 36000,
  depositAppliedCents: 0,
};
const due = (o: Partial<CheckoutAmountsInput> = {}) => computeCheckoutAmounts({ ...base, ...o }).remainderCents;

describe("computeCheckoutAmounts", () => {
  it("is the services total plus the tip", () => {
    expect(computeCheckoutAmounts(base)).toEqual({
      totalWithTip: 40000,
      bankAppliedCents: 0,
      depositAppliedCents: 0,
      giftAppliedCents: 0,
      remainderCents: 40000,
    });
    expect(due({ tipCents: 5000 })).toBe(45000);
  });

  it("takes the prepaid balance and the deposit credit off the total (tip stays on top)", () => {
    expect(due({ partialBankAppliedCents: 10000, depositAppliedCents: 20000 })).toBe(10000);
    expect(due({ partialBankAppliedCents: 10000, depositAppliedCents: 20000, tipCents: 3000 })).toBe(13000);
    expect(computeCheckoutAmounts({ ...base, partialBankAppliedCents: 10000, depositAppliedCents: 20000, tipCents: 3000 })).toEqual({
      totalWithTip: 43000,
      bankAppliedCents: 10000,
      depositAppliedCents: 20000,
      giftAppliedCents: 0,
      remainderCents: 13000,
    });
  });

  it("credits a deposit paid at booking, with or without a tip", () => {
    expect(due({ depositAppliedCents: 1000 })).toBe(39000);
    expect(due({ depositAppliedCents: 1000, tipCents: 2000 })).toBe(41000);
    expect(due({ depositAppliedCents: 0 })).toBe(40000);
  });

  it("covers the balance being larger than, equal to, or smaller than the total", () => {
    expect(due({ partialBankAppliedCents: 40000 })).toBe(0);
    expect(due({ partialBankAppliedCents: 40000, tipCents: 5000 })).toBe(5000);
    expect(due({ partialBankAppliedCents: 25000, depositAppliedCents: 1000 })).toBe(14000);
  });

  it("never goes below zero, even when the credit is bigger than the session and the tip", () => {
    expect(due({ totalCents: 10000, depositAppliedCents: 20000 })).toBe(0);
    expect(due({ totalCents: 10000, depositAppliedCents: 20000, tipCents: 5000 })).toBe(0);
    // The tip still counts once it pushes the visit past the credit.
    expect(due({ totalCents: 10000, depositAppliedCents: 20000, tipCents: 15000 })).toBe(5000);
  });

  it("paying fully from the prepaid balance uses the member-discounted total", () => {
    expect(computeCheckoutAmounts({ ...base, payingFullFromPrepaid: true, partialBankAppliedCents: 25000 })).toEqual({
      totalWithTip: 36000,
      bankAppliedCents: 36000,
      depositAppliedCents: 0,
      giftAppliedCents: 0,
      remainderCents: 0,
    });
    // A deposit paid at booking never produces a charge.
    expect(due({ payingFullFromPrepaid: true, depositAppliedCents: 1000 })).toBe(0);
  });

  it("matches the old behavior: a prepaid-balance visit owes nothing when the discount is zero", () => {
    expect(due({ payingFullFromPrepaid: true, discountedTotalCents: 40000 })).toBe(0);
  });

  it("is the same whether the project credit or a plain deposit is passed in", () => {
    // Sleeve: $400 session, $200 credit.
    expect(due({ depositAppliedCents: 20000 })).toBe(20000);
  });

  it("a credit-covered visit owes only the tip, whatever else is on file", () => {
    const covered = { creditCovered: true, partialBankAppliedCents: 10000, depositAppliedCents: 5000 };
    expect(computeCheckoutAmounts({ ...base, ...covered })).toEqual({
      totalWithTip: 0,
      bankAppliedCents: 0,
      depositAppliedCents: 0,
      giftAppliedCents: 0,
      remainderCents: 0,
    });
    expect(computeCheckoutAmounts({ ...base, ...covered, tipCents: 500 })).toEqual({
      totalWithTip: 500,
      bankAppliedCents: 0,
      depositAppliedCents: 0,
      giftAppliedCents: 0,
      remainderCents: 500,
    });
  });

  it("a credit-covered visit ignores paying fully from the prepaid balance", () => {
    expect(due({ creditCovered: true, payingFullFromPrepaid: true })).toBe(0);
    expect(due({ creditCovered: true, payingFullFromPrepaid: true, tipCents: 700 })).toBe(700);
  });

  it("creditCovered false or missing changes nothing", () => {
    expect(due({ creditCovered: false, tipCents: 5000 })).toBe(45000);
    expect(computeCheckoutAmounts({ ...base, creditCovered: false })).toEqual(computeCheckoutAmounts(base));
  });

  it("takes a gift card off after the deposit and the prepaid balance, including the tip", () => {
    expect(computeCheckoutAmounts({
      ...base,
      totalCents: 10000,
      tipCents: 2000,
      partialBankAppliedCents: 3000,
      depositAppliedCents: 1500,
      giftBalanceCents: 5000,
      giftRequestedCents: 5000,
    })).toEqual({
      totalWithTip: 12000,
      bankAppliedCents: 3000,
      depositAppliedCents: 1500,
      giftAppliedCents: 5000,
      remainderCents: 2500,
    });
    expect(computeCheckoutAmounts({
      ...base,
      creditCovered: true,
      tipCents: 2000,
      giftBalanceCents: 2000,
      giftRequestedCents: null,
    }).remainderCents).toBe(0);
  });
});
