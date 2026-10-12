import { describe, it, expect } from "vitest";
import { autoGranularity } from "./granularity";

describe("autoGranularity", () => {
  function range(startStr: string, endStr: string) {
    return { start: new Date(startStr), end: new Date(endStr) };
  }

  it("returns day for ranges under 14 days", () => {
    expect(autoGranularity(range("2026-01-01", "2026-01-10"))).toBe("day");
  });

  it("returns week for ranges 14–90 days", () => {
    expect(autoGranularity(range("2026-01-01", "2026-01-15"))).toBe("week");
    expect(autoGranularity(range("2026-01-01", "2026-03-01"))).toBe("week");
  });

  it("returns month for ranges over 90 days", () => {
    expect(autoGranularity(range("2026-01-01", "2026-06-01"))).toBe("month");
  });
});
