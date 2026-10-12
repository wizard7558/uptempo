import { describe, expect, it } from "vitest";
import {
  formatGiftCardCode,
  generateGiftCardCode,
  hashGiftCardCode,
  normalizeGiftCardCode,
} from "./code";

describe("gift card codes", () => {
  it("normalizes a dashed lowercase code", () => {
    expect(normalizeGiftCardCode("abcd-efgh-jkmn-pqrs")).toBe("ABCDEFGHJKMNPQRS");
  });

  it("maps O, I and L onto digits", () => {
    expect(normalizeGiftCardCode("oooo iiii llll 0000")).toBe("0000111111110000");
  });

  it("rejects a code that still contains U", () => {
    expect(normalizeGiftCardCode("ABCU-EFGH-JKMN-PQRS")).toBeNull();
  });

  it("rejects a 15-character code", () => {
    expect(normalizeGiftCardCode("ABCDEFGHJKMNPQR")).toBeNull();
  });

  it("hashes the normalized code", () => {
    expect(hashGiftCardCode("ABCDEFGHJKMNPQRS")).toBe(
      "f598056127fcd4387651a49b3a4235d8ce50d71f4091068df51511cfc10f388f",
    );
  });

  it("formats four groups of four", () => {
    expect(formatGiftCardCode("ABCDEFGHJKMNPQRS")).toBe("ABCD-EFGH-JKMN-PQRS");
  });

  it("draws a thousand distinct codes that already are normalized", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateGiftCardCode();
      codes.add(code);
      expect(normalizeGiftCardCode(code)).toBe(code);
    }
    expect(codes.size).toBe(1000);
  });
});
