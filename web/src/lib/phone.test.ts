import { describe, it, expect } from "vitest";
import { normalizePhone, phonesEqual } from "./phone";

describe("normalizePhone", () => {
  it("canonicalizes US 10-digit numbers across formats to E.164", () => {
    for (const input of [
      "(555) 123-4567",
      "555-123-4567",
      "555.123.4567",
      "5551234567",
      "555 123 4567",
    ]) {
      expect(normalizePhone(input)).toBe("+15551234567");
    }
  });

  it("handles the 11-digit '1' country code, with or without a plus", () => {
    expect(normalizePhone("15551234567")).toBe("+15551234567");
    expect(normalizePhone("1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("+1 555 123 4567")).toBe("+15551234567");
  });

  it("keeps explicit international numbers", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("returns null for empty or too-short input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
  });

  it("falls back to digits for unknown national formats it can't tag", () => {
    expect(normalizePhone("5551234")).toBe("5551234");
  });
});

describe("phonesEqual", () => {
  it("matches the same number written differently", () => {
    expect(phonesEqual("(555) 123-4567", "+15551234567")).toBe(true);
    expect(phonesEqual("555-123-4567", "5551234567")).toBe(true);
  });

  it("does not match different numbers or null", () => {
    expect(phonesEqual("5551234567", "5559999999")).toBe(false);
    expect(phonesEqual(null, null)).toBe(false);
    expect(phonesEqual("5551234567", null)).toBe(false);
  });
});
