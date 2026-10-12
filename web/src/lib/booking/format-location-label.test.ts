import { describe, it, expect } from "vitest";
import {
  formatLocationLines,
  formatLocationFromObject,
} from "./format-location-label";

describe("formatLocationLines", () => {
  it("returns null when all inputs empty", () => {
    expect(formatLocationLines(null, null, null)).toBeNull();
    expect(formatLocationLines(undefined, undefined, undefined)).toBeNull();
  });

  it("uses fallback when name and address missing", () => {
    expect(formatLocationLines(null, null, "123 Default Rd")).toBe("123 Default Rd");
  });

  it("joins name and address", () => {
    expect(formatLocationLines("Downtown", "1 Main St", null)).toBe(
      "Downtown - 1 Main St",
    );
  });

  it("returns only name when address missing", () => {
    expect(formatLocationLines("Downtown", null, null)).toBe("Downtown");
  });

  it("returns only address when name missing", () => {
    expect(formatLocationLines(null, "1 Main St", null)).toBe("1 Main St");
  });
});

describe("formatLocationFromObject", () => {
  it("delegates to formatLocationLines", () => {
    expect(
      formatLocationFromObject(
        { name: "A", address: "B" },
        "fallback",
      ),
    ).toBe("A - B");
    expect(formatLocationFromObject(null, "fallback")).toBe("fallback");
  });
});
