import { describe, expect, it } from "vitest";
import {
  hashPublicToken,
  isPublicTokenShape,
  newPublicToken,
  safeEqualHex,
} from "./public-token";

describe("public tokens", () => {
  it("makes 32-char url-safe tokens that pass the shape check", () => {
    const t = newPublicToken();
    expect(t).toHaveLength(32);
    expect(isPublicTokenShape(t)).toBe(true);
    expect(newPublicToken()).not.toBe(t);
  });

  it("rejects bad shapes", () => {
    expect(isPublicTokenShape("short")).toBe(false);
    expect(isPublicTokenShape("a".repeat(33))).toBe(false);
    expect(isPublicTokenShape("a".repeat(31) + "!")).toBe(false);
  });

  it("hashes to 64 hex chars, deterministically", () => {
    const h = hashPublicToken("abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPublicToken("abc")).toBe(h);
    expect(hashPublicToken("abd")).not.toBe(h);
  });
});

describe("safeEqualHex", () => {
  const h = hashPublicToken("x");
  it("is true for equal values", () => expect(safeEqualHex(h, h)).toBe(true));
  it("is false for unequal values", () =>
    expect(safeEqualHex(h, hashPublicToken("y"))).toBe(false));
  it("is false (no throw) for different lengths", () => {
    expect(safeEqualHex(h, h.slice(0, 62))).toBe(false);
    expect(safeEqualHex("", h)).toBe(false);
  });
  it("is false (no throw) for non-hex input", () => {
    expect(safeEqualHex("zz".repeat(32), "zz".repeat(32))).toBe(false);
    expect(safeEqualHex("abc", "abc")).toBe(false);
  });
});
