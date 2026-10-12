import { describe, expect, it } from "vitest";
import { entryFits, timeOfDayRange } from "./match";

describe("timeOfDayRange", () => {
  it("maps each part of the day to a clock window", () => {
    expect(timeOfDayRange("any")).toEqual({ from: "00:00", to: "23:59" });
    expect(timeOfDayRange("morning")).toEqual({ from: "00:00", to: "12:00" });
    expect(timeOfDayRange("afternoon")).toEqual({ from: "12:00", to: "17:00" });
    expect(timeOfDayRange("evening")).toEqual({ from: "17:00", to: "23:59" });
  });
});

describe("entryFits", () => {
  const afternoon = {
    dateFrom: "2026-06-17",
    dateTo: "2026-06-17",
    timeFrom: "12:00",
    timeTo: "17:00",
    staffId: null as string | null,
    locationId: null as string | null,
  };
  const opening = {
    day: "2026-06-17",
    startHHmm: "14:00",
    endHHmm: "14:30",
    staffId: "s1",
    locationId: "l1",
  };

  it("accepts a 14:00-14:30 opening inside an afternoon window", () => {
    expect(entryFits(afternoon, opening)).toBe(true);
  });

  it("rejects a morning window for an afternoon opening", () => {
    expect(entryFits({ ...afternoon, timeFrom: "00:00", timeTo: "12:00" }, opening)).toBe(false);
  });

  it("rejects a different staff member", () => {
    expect(entryFits({ ...afternoon, staffId: "s2" }, opening)).toBe(false);
  });

  it("rejects a service that ends after the window", () => {
    expect(entryFits(afternoon, { ...opening, endHHmm: "17:05" })).toBe(false);
  });
});
