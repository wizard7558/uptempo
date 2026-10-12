import { describe, it, expect } from "vitest";
import { groupWeek, validateShifts, type WorkingHoursRow } from "./week";

const LOC = "loc-1";
const row = (over: Partial<WorkingHoursRow>): WorkingHoursRow => ({
  dayOfWeek: 1,
  startTime: "09:00",
  endTime: "17:00",
  isEnabled: 1,
  locationId: LOC,
  ...over,
});

describe("groupWeek", () => {
  it("returns Mon-Fri 09:00-17:00 at the default location when there are no rows", () => {
    const week = groupWeek([], "default");
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.dayName)).toEqual([
      "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ]);
    expect(week.map((d) => d.isEnabled)).toEqual([0, 1, 1, 1, 1, 1, 0]);
    expect(week[1].shifts).toEqual([{ startTime: "09:00", endTime: "17:00", locationId: "default" }]);
  });

  it("groups several rows of one day into sorted shifts", () => {
    const week = groupWeek(
      [
        row({ startTime: "14:00", endTime: "18:00" }),
        row({ startTime: "08:00", endTime: "12:00" }),
      ],
      null,
    );
    expect(week[1].isEnabled).toBe(1);
    expect(week[1].shifts.map((s) => [s.startTime, s.endTime])).toEqual([
      ["08:00", "12:00"],
      ["14:00", "18:00"],
    ]);
  });

  it("keeps the stored times of a closed day and fills a missing location with the default", () => {
    const week = groupWeek(
      [
        row({ dayOfWeek: 2, isEnabled: 0, startTime: "10:00", endTime: "15:00", locationId: null }),
        row({ dayOfWeek: 3, locationId: null }),
      ],
      "default",
    );
    expect(week[2].isEnabled).toBe(0);
    expect(week[2].shifts).toEqual([{ startTime: "10:00", endTime: "15:00", locationId: "default" }]);
    expect(week[3].shifts[0].locationId).toBe("default");
  });

  it("a day missing from partial data takes its default while stored days win", () => {
    const week = groupWeek([row({ dayOfWeek: 6, startTime: "10:00", endTime: "15:00" })], LOC);
    expect(week[6].isEnabled).toBe(1);
    expect(week[0].isEnabled).toBe(0);
    expect(week[1].isEnabled).toBe(1);
  });

  it("ignores disabled rows on a day that also has an enabled shift", () => {
    const week = groupWeek([row({ isEnabled: 0, startTime: "06:00", endTime: "07:00" }), row({})], LOC);
    expect(week[1].shifts).toHaveLength(1);
    expect(week[1].shifts[0].startTime).toBe("09:00");
  });
});

describe("validateShifts", () => {
  const s = (startTime: string, endTime: string) => ({ startTime, endTime, locationId: LOC });

  it("accepts a single shift and split shifts with a gap", () => {
    expect(validateShifts([s("09:00", "12:00")])).toBeNull();
    expect(validateShifts([s("14:00", "17:00"), s("09:00", "12:00")])).toBeNull();
  });
  it("allows touching shifts", () => {
    expect(validateShifts([s("09:00", "12:00"), s("12:00", "17:00")])).toBeNull();
  });
  it("reports order when a shift ends at or before its start", () => {
    expect(validateShifts([s("12:00", "09:00")])).toBe("order");
    expect(validateShifts([s("12:00", "12:00")])).toBe("order");
  });
  it("reports overlap when the next shift starts before the previous ends", () => {
    expect(validateShifts([s("09:00", "13:00"), s("12:00", "17:00")])).toBe("overlap");
    expect(validateShifts([s("12:00", "17:00"), s("09:00", "13:00")])).toBe("overlap");
  });
  it("reports order before overlap", () => {
    expect(validateShifts([s("09:00", "13:00"), s("12:00", "11:00")])).toBe("order");
  });
  it("accepts an empty list", () => {
    expect(validateShifts([])).toBeNull();
  });
});
