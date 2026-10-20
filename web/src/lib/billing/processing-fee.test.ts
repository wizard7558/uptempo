import { afterEach, describe, expect, it, vi } from "vitest";
import {
  processingFeeCents,
  processingFeePercent,
  processingFixedCents,
  processingRateBps,
  processingRateLabel,
} from "./processing-fee";

const hosted = { comped: 0, processingRateBps: null as number | null };

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.PLATFORM_PROCESSING_RATE_BPS;
  delete process.env.PLATFORM_PROCESSING_FIXED_CENTS;
  delete process.env.UPTEMPO_MODE;
});

describe("processingFeeCents", () => {
  it("charges 300 cents on $60 at the default 500 bps", () => {
    expect(processingFeeCents(6000, hosted)).toBe(300);
  });

  it("charges 5 cents on $1.00 at the default rate", () => {
    expect(processingFeeCents(100, hosted)).toBe(5);
  });

  it("charges 5% on $60 even when the stored rate is 50 bps", () => {
    expect(processingFeeCents(6000, { comped: 0, processingRateBps: 50 })).toBe(300);
    expect(processingRateBps({ comped: 0, processingRateBps: 50 })).toBe(500);
  });

  it("charges nothing for a comped business, including when a fixed fee is set", () => {
    vi.stubEnv("PLATFORM_PROCESSING_FIXED_CENTS", "30");
    expect(processingFeeCents(6000, { comped: 1, processingRateBps: 500 })).toBe(0);
    expect(processingRateBps({ comped: 1, processingRateBps: 500 })).toBe(0);
  });

  it("charges nothing in single mode", () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    expect(processingFeeCents(6000, hosted)).toBe(0);
    expect(processingRateBps(hosted)).toBe(0);
  });

  it("adds a fixed 30 cents to the $60 default fee", () => {
    vi.stubEnv("PLATFORM_PROCESSING_FIXED_CENTS", "30");
    expect(processingFixedCents()).toBe(30);
    expect(processingFeeCents(6000, hosted)).toBe(330);
  });

  it("charges 5% when the rate variable is 50 or not a number", () => {
    vi.stubEnv("PLATFORM_PROCESSING_RATE_BPS", "50");
    expect(processingRateBps(hosted)).toBe(500);
    vi.stubEnv("PLATFORM_PROCESSING_RATE_BPS", "nope");
    expect(processingFeeCents(6000, hosted)).toBe(300);
  });

  it("caps the fee at one cent under the charge", () => {
    vi.stubEnv("PLATFORM_PROCESSING_FIXED_CENTS", "100");
    expect(processingFeeCents(50, hosted)).toBe(49);
  });

  it("returns 0 when the amount is 0", () => {
    expect(processingFeeCents(0, hosted)).toBe(0);
  });
});

describe("processingFeePercent", () => {
  it("turns 500 bps into 5 for a subscription percent", () => {
    expect(processingFeePercent(hosted)).toBe(5);
  });
});

describe("processingRateLabel", () => {
  it("formats 500, 50, and 350 bps", () => {
    expect(processingRateLabel(500)).toBe("5%");
    expect(processingRateLabel(50)).toBe("0.5%");
    expect(processingRateLabel(350)).toBe("3.5%");
  });
});
