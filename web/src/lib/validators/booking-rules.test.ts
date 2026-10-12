import { describe, expect, it } from "vitest";
import { bookingRulesSchema } from "./booking-rules";

const valid = {
  sameDayBooking: 1,
  minNoticeMinutes: 120,
  maxAdvanceDays: 28,
  slotIntervalMinutes: 15,
};

describe("bookingRulesSchema", () => {
  it("accepts a valid set of rules", () => {
    expect(bookingRulesSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the boundaries", () => {
    expect(
      bookingRulesSchema.safeParse({
        sameDayBooking: 0,
        minNoticeMinutes: 20160,
        maxAdvanceDays: 730,
        slotIntervalMinutes: 60,
      }).success,
    ).toBe(true);
    expect(
      bookingRulesSchema.safeParse({ ...valid, minNoticeMinutes: 0, maxAdvanceDays: 1 }).success,
    ).toBe(true);
  });

  it.each([
    ["sameDayBooking", 2],
    ["minNoticeMinutes", -1],
    ["minNoticeMinutes", 20161],
    ["minNoticeMinutes", 1.5],
    ["maxAdvanceDays", 0],
    ["maxAdvanceDays", 731],
    ["slotIntervalMinutes", 25],
    ["slotIntervalMinutes", 0],
  ])("rejects %s = %s", (key, value) => {
    expect(bookingRulesSchema.safeParse({ ...valid, [key]: value }).success).toBe(false);
  });

  it("rejects missing fields and strings", () => {
    expect(bookingRulesSchema.safeParse({ sameDayBooking: 1 }).success).toBe(false);
    expect(bookingRulesSchema.safeParse({ ...valid, maxAdvanceDays: "28" }).success).toBe(false);
  });
});
