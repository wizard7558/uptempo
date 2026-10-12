import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLATFORM_MONTHLY_FLOOR_CENTS,
  computeMonthlyBilling,
  computePlatformFee,
  feePercentForTenant,
  platformFeeForTenant,
} from "./platform-pricing";

describe("feePercentForTenant", () => {
  const original = process.env.PLATFORM_FEE_PERCENT;
  afterEach(() => {
    if (original === undefined) delete process.env.PLATFORM_FEE_PERCENT;
    else process.env.PLATFORM_FEE_PERCENT = original;
  });

  it("uses plan defaults", () => {
    expect(feePercentForTenant({ plan: "starter", platformFeePercent: null })).toBe(0.5);
    expect(feePercentForTenant({ plan: "pro", platformFeePercent: null })).toBe(1);
    expect(feePercentForTenant({ plan: "business", platformFeePercent: null })).toBe(2);
  });

  it("lets a per-tenant override win, including 0 (exemption)", () => {
    expect(feePercentForTenant({ plan: "business", platformFeePercent: 0 })).toBe(0);
    expect(feePercentForTenant({ plan: "starter", platformFeePercent: 1.25 })).toBe(1.25);
  });

  it("falls back to the env var for an unknown plan", () => {
    process.env.PLATFORM_FEE_PERCENT = "3";
    expect(feePercentForTenant({ plan: "mystery", platformFeePercent: null })).toBe(3);
  });

  it("is 0 in single mode even when the plan would charge", () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    expect(feePercentForTenant({ plan: "business", platformFeePercent: 2 })).toBe(0);
    vi.unstubAllEnvs();
  });
});

describe("computePlatformFee", () => {
  it("charges the $50 floor below break-even", () => {
    // pro (1%) with $1,000/mo → 1% = $10 → floor $50 wins.
    const fee = computePlatformFee(1, 100_000);
    expect(fee.percentFeeCents).toBe(1_000);
    expect(fee.chargeCents).toBe(PLATFORM_MONTHLY_FLOOR_CENTS);
    expect(fee.isFloor).toBe(true);
  });

  it("charges the percentage above break-even", () => {
    // pro (1%) with $10,000/mo → 1% = $100.
    const fee = computePlatformFee(1, 1_000_000);
    expect(fee.percentFeeCents).toBe(10_000);
    expect(fee.chargeCents).toBe(10_000);
    expect(fee.isFloor).toBe(false);
  });

  it("treats the break-even point as the floor (inclusive)", () => {
    // pro (1%): break-even is $5,000/mo → 1% = $50 = floor.
    const fee = computePlatformFee(1, 500_000);
    expect(fee.percentFeeCents).toBe(5_000);
    expect(fee.chargeCents).toBe(5_000);
    expect(fee.isFloor).toBe(true);
    expect(fee.breakEvenRevenueCents).toBe(500_000);
  });

  it("computes break-even per rate", () => {
    expect(computePlatformFee(0.5, 0).breakEvenRevenueCents).toBe(1_000_000); // $10k
    expect(computePlatformFee(1, 0).breakEvenRevenueCents).toBe(500_000); // $5k
    expect(computePlatformFee(2, 0).breakEvenRevenueCents).toBe(250_000); // $2.5k
  });

  it("fully exempts a 0% rate (no floor)", () => {
    const fee = computePlatformFee(0, 1_000_000);
    expect(fee.chargeCents).toBe(0);
    expect(fee.percentFeeCents).toBe(0);
    expect(fee.isFloor).toBe(false);
    expect(fee.breakEvenRevenueCents).toBeNull();
  });

  it("guards against negative / non-finite input", () => {
    expect(computePlatformFee(1, -500).chargeCents).toBe(
      PLATFORM_MONTHLY_FLOOR_CENTS,
    );
    expect(computePlatformFee(Number.NaN, 1_000_000).chargeCents).toBe(0);
  });
});

describe("platformFeeForTenant", () => {
  it("applies the resolved plan percent to revenue", () => {
    // business (2%) with $20,000/mo → 2% = $400.
    const fee = platformFeeForTenant(
      { plan: "business", platformFeePercent: null },
      2_000_000,
    );
    expect(fee.feePercent).toBe(2);
    expect(fee.chargeCents).toBe(40_000);
  });

  it("exempts a 0%-override tenant entirely", () => {
    const fee = platformFeeForTenant(
      { plan: "business", platformFeePercent: 0 },
      2_000_000,
    );
    expect(fee.chargeCents).toBe(0);
  });
});

describe("computeMonthlyBilling", () => {
  it("tops up to the floor when fees collected are below it", () => {
    const r = computeMonthlyBilling({ feePercent: 1, feesCollectedCents: 1_000 });
    expect(r.amountToChargeCents).toBe(4_000); // 5000 - 1000
    // total paid ends at the floor
    expect(r.feesCollectedCents + r.amountToChargeCents).toBe(
      PLATFORM_MONTHLY_FLOOR_CENTS,
    );
  });

  it("charges nothing when fees already meet the floor", () => {
    expect(
      computeMonthlyBilling({ feePercent: 1, feesCollectedCents: 5_000 })
        .amountToChargeCents,
    ).toBe(0);
  });

  it("charges nothing when fees exceed the floor (percentage already paid)", () => {
    expect(
      computeMonthlyBilling({ feePercent: 1, feesCollectedCents: 8_000 })
        .amountToChargeCents,
    ).toBe(0);
  });

  it("charges nothing for a fee-exempt tenant", () => {
    const r = computeMonthlyBilling({ feePercent: 0, feesCollectedCents: 0 });
    expect(r.exempt).toBe(true);
    expect(r.amountToChargeCents).toBe(0);
  });

  it("guards against negative fees-collected", () => {
    expect(
      computeMonthlyBilling({ feePercent: 1, feesCollectedCents: -100 })
        .amountToChargeCents,
    ).toBe(PLATFORM_MONTHLY_FLOOR_CENTS);
  });
});
