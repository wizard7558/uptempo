import { describe, expect, it } from "vitest";
import {
  bookingAudienceLabel,
  canClientBookService,
  isBookingAudience,
  isNewClient,
} from "./booking-audience";

describe("isNewClient", () => {
  it("matches client_status_at_booking semantics (0 booked = new)", () => {
    expect(isNewClient(0)).toBe(true);
    expect(isNewClient(null)).toBe(true);
    expect(isNewClient(undefined)).toBe(true);
    expect(isNewClient(1)).toBe(false);
    expect(isNewClient(37)).toBe(false);
  });
});

describe("canClientBookService — eligibility matrix", () => {
  it.each([
    // audience, isNew, expected
    ["all", true, true],
    ["all", false, true],
    ["new", true, true],
    ["new", false, false],
    ["returning", true, false],
    ["returning", false, true],
  ] as const)("audience=%s isNew=%s -> %s", (audience, isNew, expected) => {
    expect(canClientBookService(audience, isNew)).toBe(expected);
  });

  it("fails open for unknown/legacy/null values (treated as 'all')", () => {
    expect(canClientBookService(null, true)).toBe(true);
    expect(canClientBookService(undefined, false)).toBe(true);
    expect(canClientBookService("everyone", true)).toBe(true);
  });
});

describe("isBookingAudience", () => {
  it("accepts exactly the three values", () => {
    expect(isBookingAudience("all")).toBe(true);
    expect(isBookingAudience("new")).toBe(true);
    expect(isBookingAudience("returning")).toBe(true);
    expect(isBookingAudience("ALL")).toBe(false);
    expect(isBookingAudience("")).toBe(false);
    expect(isBookingAudience(null)).toBe(false);
    expect(isBookingAudience(1)).toBe(false);
  });
});

describe("bookingAudienceLabel", () => {
  it("labels all three plus fallback", () => {
    expect(bookingAudienceLabel("all")).toBe("Everyone");
    expect(bookingAudienceLabel("new")).toBe("New clients only");
    expect(bookingAudienceLabel("returning")).toBe("Returning clients");
    expect(bookingAudienceLabel("bogus")).toBe("Everyone");
  });
});
