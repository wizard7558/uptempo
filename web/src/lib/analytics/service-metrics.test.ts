import { describe, expect, it } from "vitest";
import { computeServiceAnalytics } from "./service-metrics";
import {
  FIXTURE_EXPECTED,
  FIXTURE_HISTORY,
  FIXTURE_LINES,
  toTableRow,
} from "./service-metrics-fixture";

describe("computeServiceAnalytics", () => {
  it("reproduces the plan's expected table for the shared fixture", () => {
    const out = computeServiceAnalytics(FIXTURE_LINES, FIXTURE_HISTORY);
    const computed = {
      byService: out.byService.map(toTableRow),
      byStaff: out.byStaff.map(toTableRow),
      totals: toTableRow(out.totals),
    };
    expect(computed).toEqual(FIXTURE_EXPECTED);
  });

  it("returns empty arrays, zero totals and null rates for no input", () => {
    const out = computeServiceAnalytics([], []);
    expect(out.byService).toEqual([]);
    expect(out.byStaff).toEqual([]);
    expect(out.totals).toMatchObject({
      bookings: 0,
      completed: 0,
      noShows: 0,
      revenueCents: 0,
      avgTicketCents: null,
      rebookRate: null,
      noShowRate: null,
      hoursBooked: 0,
    });
  });

  it("ignores a cancelled line", () => {
    const cancelled = { ...FIXTURE_LINES[0], appointmentId: "A5", status: "cancelled" };
    const a = computeServiceAnalytics([...FIXTURE_LINES, cancelled], FIXTURE_HISTORY);
    const b = computeServiceAnalytics(FIXTURE_LINES, FIXTURE_HISTORY);
    expect(a).toEqual(b);
  });

  it("counts the same service twice in one visit as one booking, summing cents and minutes", () => {
    const l = FIXTURE_LINES[0];
    const out = computeServiceAnalytics(
      [l, { ...l, lineCents: 2000, lineMinutes: 15 }],
      [],
    );
    expect(out.byService).toHaveLength(1);
    expect(out.byService[0]).toMatchObject({
      bookings: 1,
      revenueCents: 7000,
      minutesBooked: 75,
    });
    expect(out.totals.bookings).toBe(1);
  });
});
