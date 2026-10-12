import { describe, expect, it } from "vitest";
import {
  addDays,
  contains,
  daysBetween,
  dayOfWeekOf,
  localDay,
  mergeIntervals,
  minutesUntilNextLocalMidnight,
  overlaps,
  subtract,
  wallClockToDate,
} from "./intervals";
import { estimateTravelMinutes, haversineKm } from "./travel";

const d = (iso: string) => new Date(iso);
const I = (a: string, b: string) => ({ start: d(a), end: d(b) });

describe("intervals", () => {
  it("overlaps is half-open", () => {
    expect(overlaps(I("2026-01-01T09:00Z", "2026-01-01T10:00Z"), I("2026-01-01T10:00Z", "2026-01-01T11:00Z"))).toBe(false);
    expect(overlaps(I("2026-01-01T09:00Z", "2026-01-01T10:01Z"), I("2026-01-01T10:00Z", "2026-01-01T11:00Z"))).toBe(true);
  });

  it("contains allows touching edges", () => {
    const outer = I("2026-01-01T09:00Z", "2026-01-01T17:00Z");
    expect(contains(outer, I("2026-01-01T09:00Z", "2026-01-01T17:00Z"))).toBe(true);
    expect(contains(outer, I("2026-01-01T08:59Z", "2026-01-01T10:00Z"))).toBe(false);
  });

  it("mergeIntervals merges touching and overlapping, drops empty", () => {
    const out = mergeIntervals([
      I("2026-01-01T11:00Z", "2026-01-01T12:00Z"),
      I("2026-01-01T09:00Z", "2026-01-01T10:00Z"),
      I("2026-01-01T10:00Z", "2026-01-01T10:30Z"),
      I("2026-01-01T13:00Z", "2026-01-01T13:00Z"),
    ]);
    expect(out.map((i) => [i.start.toISOString(), i.end.toISOString()])).toEqual([
      ["2026-01-01T09:00:00.000Z", "2026-01-01T10:30:00.000Z"],
      ["2026-01-01T11:00:00.000Z", "2026-01-01T12:00:00.000Z"],
    ]);
  });

  it("subtract splits around cuts", () => {
    const out = subtract(I("2026-01-01T09:00Z", "2026-01-01T17:00Z"), [
      I("2026-01-01T10:00Z", "2026-01-01T11:00Z"),
      I("2026-01-01T16:00Z", "2026-01-01T18:00Z"),
    ]);
    expect(out.map((i) => [i.start.toISOString(), i.end.toISOString()])).toEqual([
      ["2026-01-01T09:00:00.000Z", "2026-01-01T10:00:00.000Z"],
      ["2026-01-01T11:00:00.000Z", "2026-01-01T16:00:00.000Z"],
    ]);
    expect(subtract(I("2026-01-01T09:00Z", "2026-01-01T10:00Z"), [I("2026-01-01T08:00Z", "2026-01-01T11:00Z")])).toEqual([]);
  });

  it("wallClockToDate handles standard time, DST gap and ambiguous hour (later occurrence)", () => {
    expect(wallClockToDate("2026-01-15", "09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
    expect(wallClockToDate("2026-07-15", "09:00", "America/New_York").toISOString()).toBe("2026-07-15T13:00:00.000Z");
    // 02:30 does not exist on 2026-03-08; it resolves forward (03:30 EDT).
    expect(wallClockToDate("2026-03-08", "02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 happens twice on 2026-11-01; the later occurrence is EST.
    expect(wallClockToDate("2026-11-01", "01:30", "America/New_York").toISOString()).toBe("2026-11-01T06:30:00.000Z");
    expect(wallClockToDate("2026-06-17", "24:00", "UTC").toISOString()).toBe("2026-06-18T00:00:00.000Z");
  });

  it("rejects malformed input", () => {
    expect(() => wallClockToDate("2026-6-1", "09:00", "UTC")).toThrow();
    expect(() => wallClockToDate("2026-06-01", "9am", "UTC")).toThrow();
  });

  it("calendar helpers", () => {
    expect(dayOfWeekOf("2026-06-17")).toBe(3);
    expect(dayOfWeekOf("2026-06-14")).toBe(0);
    expect(localDay(d("2026-06-17T03:30:00Z"), "America/New_York")).toBe("2026-06-16");
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetween("2026-03-08", "2026-03-07")).toBe(-1);
  });
});

describe("addDays", () => {
  it("rolls over months, years and leap days", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-06-17", 28)).toBe("2026-07-15");
    expect(addDays("2026-06-17", 0)).toBe("2026-06-17");
  });
});

describe("minutesUntilNextLocalMidnight", () => {
  const NY = "America/New_York";
  it("counts to the next local midnight", () => {
    // 2026-06-17 12:00 EDT -> 12 hours
    expect(minutesUntilNextLocalMidnight(d("2026-06-17T16:00:00Z"), NY)).toBe(720);
  });
  it("rounds up partial minutes", () => {
    expect(minutesUntilNextLocalMidnight(d("2026-06-17T16:00:30Z"), NY)).toBe(720);
  });
  it("accounts for the spring-forward day (23 hours long)", () => {
    // 2026-03-07 22:00 EST -> midnight EST is 2 hours away
    expect(minutesUntilNextLocalMidnight(d("2026-03-08T03:00:00Z"), NY)).toBe(120);
    // 2026-03-08 07:00 EST (12:00Z) -> midnight 2026-03-09 EDT (04:00Z) is 16 hours away
    expect(minutesUntilNextLocalMidnight(d("2026-03-08T12:00:00Z"), NY)).toBe(960);
  });
});

describe("travel", () => {
  it("haversine is ~111.19 km per degree of latitude", () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBe(0);
  });

  it("estimateTravelMinutes applies 1.4 road factor and rounds up to 5", () => {
    // 0.1 deg lat = 11.119 km; x1.4 = 15.57 km; at 60 km/h = 15.57 min -> 20
    expect(estimateTravelMinutes({ lat: 0, lng: 0 }, { lat: 0.1, lng: 0 }, 60)).toBe(20);
    expect(estimateTravelMinutes({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, 60)).toBe(0);
    expect(estimateTravelMinutes({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }, 60)).toBe(5);
    expect(estimateTravelMinutes({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, 0)).toBe(Infinity);
  });
});
