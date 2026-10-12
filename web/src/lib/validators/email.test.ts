import { describe, expect, it } from "vitest";
import { isLikelyEmail, normalizeEmail, parseEmailList } from "./email";

describe("normalizeEmail", () => {
  it.each([
    ["emma@example.com", "emma@example.com"],
    ["  Emma@Example.COM  ", "emma@example.com"],
    ["emma+quiz@example.co.uk", "emma+quiz@example.co.uk"],
  ])("normalizes %p -> %p", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each([
    "not-an-email",
    "emma@",
    "@example.com",
    "emma@example",
    "emma example@test.com",
    "",
    "   ",
    undefined,
    null,
  ])("rejects %p", (input) => {
    expect(normalizeEmail(input)).toBeNull();
  });

  it("ignores non-string input", () => {
    expect(normalizeEmail(42 as unknown as string)).toBeNull();
  });

  it("is idempotent", () => {
    const once = normalizeEmail("  Emma@Example.com ")!;
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe("parseEmailList", () => {
  it("splits, normalizes, and dedupes a comma-separated list", () => {
    expect(
      parseEmailList(" Riley@Example.com , emma@example.com , riley@example.com "),
    ).toEqual(["riley@example.com", "emma@example.com"]);
  });

  it("keeps a single address working", () => {
    expect(parseEmailList("emma@example.com")).toEqual(["emma@example.com"]);
  });

  it("drops malformed entries instead of failing the whole list", () => {
    // One fat-fingered address in Vercel must not silence the other recipients.
    expect(parseEmailList("good@example.com,,bogus, ,also@example.com")).toEqual([
      "good@example.com",
      "also@example.com",
    ]);
  });

  it.each(["", "   ", ",,,", "nope", undefined, null])(
    "returns an empty list for %p",
    (input) => {
      expect(parseEmailList(input)).toEqual([]);
    },
  );
});

describe("isLikelyEmail", () => {
  it("agrees with normalizeEmail", () => {
    // The post-quiz prompt gates its one-tap "Yes" on this, while the server
    // action gates the insert on normalizeEmail — they must never disagree.
    for (const value of ["emma@example.com", "  A@b.co ", "nope", "", "x@y"]) {
      expect(isLikelyEmail(value)).toBe(normalizeEmail(value) !== null);
    }
  });
});
