import { describe, expect, it } from "vitest";
import {
  canSaveAnyway,
  formatDayLabel,
  formatTimeRange,
  formatWeekRange,
  groupByDay,
  isDay,
  resolveWeek,
  startTimeOptions,
  weekStartOf,
} from "./week";

describe("week helpers", () => {
  it("finds the Monday of any week, including Sundays", () => {
    expect(weekStartOf("2026-06-15")).toBe("2026-06-15"); // Monday
    expect(weekStartOf("2026-06-17")).toBe("2026-06-15");
    expect(weekStartOf("2026-06-21")).toBe("2026-06-15"); // Sunday
    expect(weekStartOf("2026-06-22")).toBe("2026-06-22");
  });

  it("uses the week param when it is a real date, otherwise this week", () => {
    expect(resolveWeek("2026-06-24", "2026-01-01")).toBe("2026-06-22");
    expect(resolveWeek("nonsense", "2026-06-17")).toBe("2026-06-15");
    expect(resolveWeek("2026-02-31", "2026-06-17")).toBe("2026-06-15");
    expect(resolveWeek(undefined, "2026-06-17")).toBe("2026-06-15");
    expect(isDay("2026-06-15")).toBe(true);
    expect(isDay("2026-6-15")).toBe(false);
  });

  it("formats day labels, week ranges and AM/PM time ranges", () => {
    expect(formatDayLabel("2026-06-15")).toBe("Mon, Jun 15");
    expect(formatWeekRange("2026-06-15")).toBe("Jun 15 to Jun 21");
    expect(formatTimeRange(new Date("2026-06-15T13:00:00Z"), new Date("2026-06-15T13:45:00Z"), "America/Chicago")).toBe(
      "8:00 AM to 8:45 AM",
    );
    expect(formatTimeRange(new Date("2026-06-15T22:30:00Z"), new Date("2026-06-15T23:30:00Z"), "UTC")).toBe(
      "10:30 PM to 11:30 PM",
    );
  });

  it("groups sessions by the business's local day, not UTC", () => {
    const sessions = [
      { id: "a", start: new Date("2026-06-16T03:30:00Z") }, // Mon 10:30 PM in Chicago
      { id: "b", start: new Date("2026-06-16T12:00:00Z") }, // Tue 7:00 AM
      { id: "c", start: new Date("2026-06-16T23:00:00Z") }, // Tue 6:00 PM
      { id: "d", start: new Date("2026-06-18T12:00:00Z") },
    ];
    const groups = groupByDay(sessions, "America/Chicago");
    expect(groups.map((g) => [g.day, g.label, g.sessions.map((s) => s.id)])).toEqual([
      ["2026-06-15", "Mon, Jun 15", ["a"]],
      ["2026-06-16", "Tue, Jun 16", ["b", "c"]],
      ["2026-06-18", "Thu, Jun 18", ["d"]],
    ]);
    expect(groupByDay([], "UTC")).toEqual([]);
  });

  it("offers a start time every 15 minutes with AM/PM labels", () => {
    const opts = startTimeOptions();
    expect(opts).toHaveLength(96);
    expect(opts[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(opts[25]).toEqual({ value: "06:15", label: "6:15 AM" });
    expect(opts[48]).toEqual({ value: "12:00", label: "12:00 PM" });
    expect(opts[95]).toEqual({ value: "23:45", label: "11:45 PM" });
  });
});

describe("canSaveAnyway", () => {
  it("is true only when every clash is an appointment", () => {
    expect(canSaveAnyway([{ date: "2026-06-15", reason: "appointment" }])).toBe(true);
    expect(
      canSaveAnyway([
        { date: "2026-06-15", reason: "appointment" },
        { date: "2026-06-22", reason: "appointment" },
      ]),
    ).toBe(true);
  });

  it("is false when any clash is a block, or another kind", () => {
    expect(canSaveAnyway([{ date: "2026-06-15", reason: "block" }])).toBe(false);
    expect(
      canSaveAnyway([
        { date: "2026-06-15", reason: "appointment" },
        { date: "2026-06-22", reason: "block" },
      ]),
    ).toBe(false);
    for (const reason of ["external", "task", "class"] as const) {
      expect(canSaveAnyway([{ date: "2026-06-15", reason }])).toBe(false);
    }
  });

  it("is false when there are no clashes", () => {
    expect(canSaveAnyway([])).toBe(false);
  });
});
