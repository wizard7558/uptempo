import { describe, expect, it } from "vitest";

import { contrastRatio, ensureContrast } from "./contrast";

describe("contrast", () => {
  it("treats white on black as the maximum ratio", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
  });

  it("rounds crimson on white to 6.9", () => {
    expect(Math.round(contrastRatio("#B3122E", "#FFFFFF") * 10) / 10).toBe(6.9);
  });

  it("darkens pure yellow on white until text is readable", () => {
    const adjusted = ensureContrast("#FFFF00", "#FFFFFF", 4.5);
    expect(adjusted).toBe("#7A7A00");
    expect(contrastRatio(adjusted, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });
});
