import { describe, it, expect } from "vitest";
import { buildStoredValueCheckoutPreview } from "@/lib/checkout/stored-value-preview";

describe("buildStoredValueCheckoutPreview", () => {
  it("applies member discount and eligibleForFullBb when balance covers discounted total", () => {
    const p = buildStoredValueCheckoutPreview(
      10_000,
      10_000,
      20,
      true,
    );
    expect(p.totalCents).toBe(10_000);
    expect(p.discountedTotalCents).toBe(8_000);
    expect(p.partialBbAppliedCents).toBe(10_000);
    expect(p.cardChargeCentsPartial).toBe(0);
    expect(p.eligibleForFullBb).toBe(true);
    expect(p.memberDiscountPercent).toBe(20);
    expect(p.hasActiveMembership).toBe(true);
  });

  it("does not apply discount without active membership", () => {
    const p = buildStoredValueCheckoutPreview(10_000, 10_000, 20, false);
    expect(p.discountedTotalCents).toBe(10_000);
    expect(p.eligibleForFullBb).toBe(false);
    expect(p.memberDiscountPercent).toBe(20);
    expect(p.hasActiveMembership).toBe(false);
  });

  it("partial BB unchanged: min(balance, total) and card remainder use list price", () => {
    const p = buildStoredValueCheckoutPreview(3_000, 10_000, 20, true);
    expect(p.discountedTotalCents).toBe(8_000);
    expect(p.partialBbAppliedCents).toBe(3_000);
    expect(p.cardChargeCentsPartial).toBe(7_000);
    expect(p.eligibleForFullBb).toBe(false);
  });

  it("rounds discount to whole cents", () => {
    const p = buildStoredValueCheckoutPreview(100_000, 10_101, 15, true);
    const discount = 10_101 - p.discountedTotalCents;
    expect(discount).toBe(Math.round((10_101 * 15) / 100));
    expect(p.discountedTotalCents).toBe(10_101 - discount);
  });

  it("clamps discount percent to 0–100", () => {
    const low = buildStoredValueCheckoutPreview(1000, 5000, -5, true);
    expect(low.memberDiscountPercent).toBe(0);
    expect(low.discountedTotalCents).toBe(5000);

    const high = buildStoredValueCheckoutPreview(1000, 5000, 150, true);
    expect(high.memberDiscountPercent).toBe(100);
    expect(high.discountedTotalCents).toBe(0);
    expect(high.eligibleForFullBb).toBe(false);
  });
});
