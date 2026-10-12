import { describe, it, expect } from "vitest";
import {
  calculateAppointmentPrice,
  calculateFee,
  isWithinCancellationWindow,
} from "./policy-engine";

describe("calculateAppointmentPrice", () => {
  it("uses priceChargedCents snapshot when set", () => {
    expect(
      calculateAppointmentPrice([
        { priceChargedCents: 9999, priceCents: 5000 },
      ]),
    ).toBe(9999);
  });

  it("falls back to list price when snapshot is null", () => {
    expect(
      calculateAppointmentPrice([
        { priceChargedCents: null, priceCents: 7500 },
      ]),
    ).toBe(7500);
  });

  it("sums multiple lines", () => {
    expect(
      calculateAppointmentPrice([
        { priceChargedCents: 5000, priceCents: 4000 },
        { priceChargedCents: null, priceCents: 3000 },
      ]),
    ).toBe(8000);
  });
});

describe("calculateFee", () => {
  it("rounds percentage fee to integer cents", () => {
    const r = calculateFee(10000, 15, "no_show");
    expect(r.feeCents).toBe(1500);
    expect(r.reason).toBe("no_show");
  });
});

describe("isWithinCancellationWindow", () => {
  it("returns true when appointment is soon but in the future", () => {
    const start = new Date(Date.now() + 60 * 60 * 1000); // +1h
    expect(isWithinCancellationWindow(start, 24)).toBe(true);
  });

  it("returns false when appointment is far in the future", () => {
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expect(isWithinCancellationWindow(start, 24)).toBe(false);
  });
});
