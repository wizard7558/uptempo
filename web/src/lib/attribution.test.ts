import { describe, expect, it } from "vitest";
import {
  cleanSource,
  sourceFromSearchParams,
  viaQuizSource,
} from "./attribution";

describe("cleanSource", () => {
  it.each([
    ["chair", "chair"],
    ["expo-2026", "expo-2026"],
    ["Expo 2026", "expo-2026"],
    ["  CHAIR  ", "chair"],
    ["salon expo / booth 12", "salon-expo-booth-12"],
    ["--leading-and-trailing--", "leading-and-trailing"],
    ["café", "caf"],
  ])("normalizes %p -> %p", (input, expected) => {
    expect(cleanSource(input)).toBe(expected);
  });

  it.each(["", "   ", "!!!", "---", undefined, null])(
    "returns null for %p",
    (input) => {
      expect(cleanSource(input)).toBeNull();
    },
  );

  it("caps at 64 chars without leaving a trailing hyphen", () => {
    // 63 chars, then a separator, then more — truncation would land on the "-".
    const input = `${"a".repeat(63)} tail`;
    const result = cleanSource(input);
    expect(result).toBe("a".repeat(63));
    expect(result).not.toMatch(/-$/);
  });

  it("is idempotent — cleaning an already-clean label is a no-op", () => {
    const once = cleanSource("Salon Expo 2026")!;
    expect(cleanSource(once)).toBe(once);
  });

  it("ignores non-string input", () => {
    expect(cleanSource(42 as unknown as string)).toBeNull();
  });
});

describe("viaQuizSource", () => {
  it("prefixes the original placement so it survives the quiz hop", () => {
    expect(viaQuizSource("chair")).toBe("quiz-chair");
    expect(viaQuizSource("Expo 2026")).toBe("quiz-expo-2026");
  });

  it.each([null, undefined, "", "!!!"])(
    "falls back to a bare 'quiz' label for %p",
    (input) => {
      expect(viaQuizSource(input)).toBe("quiz");
    },
  );

  it("stays within the column cap and never ends in a hyphen", () => {
    const result = viaQuizSource("a".repeat(120));
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result).not.toMatch(/-$/);
    expect(result.startsWith("quiz-")).toBe(true);
  });

  it("produces a label that is stable under cleanSource", () => {
    const label = viaQuizSource("Salon Expo 2026");
    expect(cleanSource(label)).toBe(label);
  });

  it("is distinguishable from a direct /waitlist visit", () => {
    expect(viaQuizSource("chair")).not.toBe(cleanSource("chair"));
  });
});

describe("sourceFromSearchParams", () => {
  it("reads and normalizes ?src=", () => {
    expect(sourceFromSearchParams({ src: "Expo 2026" })).toBe("expo-2026");
  });

  it("uses the first value when the param repeats", () => {
    expect(sourceFromSearchParams({ src: ["chair", "flyer"] })).toBe("chair");
  });

  it("returns null when absent", () => {
    expect(sourceFromSearchParams({})).toBeNull();
    expect(sourceFromSearchParams(undefined)).toBeNull();
    expect(sourceFromSearchParams({ other: "x" })).toBeNull();
  });
});
