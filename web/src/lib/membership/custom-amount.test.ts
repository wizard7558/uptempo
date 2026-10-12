import { describe, it, expect } from "vitest";
import { customAmountError } from "./custom-amount";

const plan = {
  allowCustomAmount: 1,
  monthlyAmountCents: 10000, // $100 minimum
  stripeProductId: "prod_1",
};

describe("customAmountError", () => {
  it("accepts a whole-dollar amount at the minimum", () => {
    expect(customAmountError(plan, 10000)).toBeNull();
  });

  it("accepts a whole-dollar amount above the minimum", () => {
    expect(customAmountError(plan, 25000)).toBeNull();
  });

  it("rejects below the minimum", () => {
    expect(customAmountError(plan, 9900)).toMatch(/Minimum is \$100/);
  });

  it("rejects non-whole-dollar amounts", () => {
    expect(customAmountError(plan, 10050)).toMatch(/whole dollar/i);
  });

  it("rejects when custom amounts are not enabled", () => {
    expect(
      customAmountError({ ...plan, allowCustomAmount: 0 }, 25000),
    ).toMatch(/not enabled/i);
  });

  it("rejects absurdly large amounts", () => {
    // Whole-dollar amount above the $100k cap (so it passes the prior checks).
    expect(customAmountError(plan, 100_001_00)).toMatch(/too large/i);
  });

  it("rejects when the plan has no Stripe product", () => {
    expect(
      customAmountError({ ...plan, stripeProductId: null }, 25000),
    ).toMatch(/no Stripe product/i);
  });
});
