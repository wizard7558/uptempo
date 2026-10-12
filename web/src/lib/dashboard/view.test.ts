import { describe, expect, it } from "vitest";

import {
  cumulativeRevenueSeries,
  deltaArrow,
  firstNameOf,
  formatDollars,
  formatPercentPoints,
  formatSignedDollars,
  formatUnitMagnitude,
  greetingForHour,
  kpiTone,
  zonedHour,
} from "./view";

describe("zonedHour", () => {
  it("reads the wall-clock hour in the target timezone, not UTC", () => {
    // 02:00 UTC on a July day (US DST): New York is UTC-4, Tokyo UTC+9.
    const instant = new Date("2026-07-23T02:00:00Z");
    expect(zonedHour(instant, "UTC")).toBe(2);
    expect(zonedHour(instant, "America/New_York")).toBe(22); // previous evening
    expect(zonedHour(instant, "Asia/Tokyo")).toBe(11);
  });

  it("does not roll the hour forward across the UTC midnight boundary", () => {
    // 03:30 UTC is 23:30 the PREVIOUS day in New York (UTC-4) — hour 23, not 3.
    const instant = new Date("2026-07-23T03:30:00Z");
    expect(zonedHour(instant, "America/New_York")).toBe(23);
    expect(greetingForHour(zonedHour(instant, "America/New_York"))).toBe(
      "Good evening",
    );
  });
});

describe("greetingForHour", () => {
  it("splits the day into morning, afternoon, and evening", () => {
    expect(greetingForHour(0)).toBe("Good morning");
    expect(greetingForHour(11)).toBe("Good morning");
    expect(greetingForHour(12)).toBe("Good afternoon");
    expect(greetingForHour(17)).toBe("Good afternoon");
    expect(greetingForHour(18)).toBe("Good evening");
    expect(greetingForHour(23)).toBe("Good evening");
  });
});

describe("firstNameOf", () => {
  it("returns the first word", () => {
    expect(firstNameOf("Jane Smith")).toBe("Jane");
    expect(firstNameOf("  Ada  Lovelace ")).toBe("Ada");
  });
  it("returns null when there is nothing usable", () => {
    expect(firstNameOf(null)).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf("   ")).toBeNull();
  });
});

describe("cumulativeRevenueSeries", () => {
  it("accumulates the running total", () => {
    expect(
      cumulativeRevenueSeries([
        { date: "2026-07-01", revenueCents: 1000 },
        { date: "2026-07-02", revenueCents: 0 },
        { date: "2026-07-03", revenueCents: 2500 },
      ]),
    ).toEqual([
      { date: "2026-07-01", cumulativeCents: 1000 },
      { date: "2026-07-02", cumulativeCents: 1000 },
      { date: "2026-07-03", cumulativeCents: 3500 },
    ]);
  });
  it("returns an empty array unchanged", () => {
    expect(cumulativeRevenueSeries([])).toEqual([]);
  });
});

describe("kpiTone", () => {
  it("treats a rise as good when higher is better", () => {
    expect(kpiTone(5, { higherIsBetter: true })).toBe("positive");
    expect(kpiTone(-5, { higherIsBetter: true })).toBe("negative");
  });
  it("treats a fall as good when lower is better (e.g. cancellations)", () => {
    expect(kpiTone(-0.03, { higherIsBetter: false })).toBe("positive");
    expect(kpiTone(0.03, { higherIsBetter: false })).toBe("negative");
  });
  it("is neutral on no change", () => {
    expect(kpiTone(0, { higherIsBetter: true })).toBe("neutral");
    expect(kpiTone(0, { higherIsBetter: false })).toBe("neutral");
  });
});

describe("deltaArrow", () => {
  it("points by sign", () => {
    expect(deltaArrow(1)).toBe("↑");
    expect(deltaArrow(-1)).toBe("↓");
    expect(deltaArrow(0)).toBe("→");
  });
});

describe("money formatting", () => {
  it("formats whole dollars with separators", () => {
    expect(formatDollars(123456)).toBe("$1,235");
    expect(formatDollars(0)).toBe("$0");
  });
  it("signs deltas with a true minus glyph", () => {
    expect(formatSignedDollars(50000)).toBe("+$500");
    expect(formatSignedDollars(-50000)).toBe("−$500");
  });
  it("formats percentage points and unit magnitudes", () => {
    expect(formatPercentPoints(0.021)).toBe("2.1%");
    expect(formatPercentPoints(-0.021)).toBe("2.1%");
    expect(formatUnitMagnitude(-1.25)).toBe("1.3");
  });
});
