import { describe, expect, it } from "vitest";
import {
  REFERENCE_PROFILE,
  breakEvenTicketCents,
  processingMargin,
  ticketForMarginCents,
} from "./processing-margin";

const FIVE_PERCENT = { rateBps: 500, fixedCents: 0 };

describe("processingMargin", () => {
  it("nets about 1.2% on the reference profile at 5%", () => {
    const margin = processingMargin(REFERENCE_PROFILE, FIVE_PERCENT);
    expect(margin.netPercent).toBeGreaterThanOrEqual(0.005);
    expect(margin.netPercent).toBeCloseTo(0.012375, 5);
    expect(margin.netCents).toBeCloseTo(74.25, 2);
  });

  it("nets below zero at 3% on a $60 ticket", () => {
    const margin = processingMargin(REFERENCE_PROFILE, {
      rateBps: 300,
      fixedCents: 0,
    });
    expect(margin.netCents).toBeLessThan(0);
  });

  it("breaks even between $20 and $21 and reaches 0.5% at about $28", () => {
    const breakEven = breakEvenTicketCents(REFERENCE_PROFILE, FIVE_PERCENT);
    expect(breakEven).not.toBeNull();
    expect(breakEven!).toBeGreaterThanOrEqual(2000);
    expect(breakEven!).toBeLessThanOrEqual(2100);

    const halfPercent = ticketForMarginCents(
      REFERENCE_PROFILE,
      FIVE_PERCENT,
      0.005,
    );
    // About $28. The search is per cent, so this is the first cent that clears 0.5%.
    expect(halfPercent).toBe(2730);
  });
});
