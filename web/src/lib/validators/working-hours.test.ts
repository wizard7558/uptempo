import { describe, it, expect } from "vitest";
import { weeklyScheduleSchema, overrideSchema } from "./working-hours";

const STAFF = "11111111-1111-4111-8111-111111111111";
const LOC = "22222222-2222-4222-8222-222222222222";
const shift = (startTime: string, endTime: string) => ({ startTime, endTime, locationId: LOC });

const week = (over: Record<number, { isEnabled: 0 | 1; shifts: ReturnType<typeof shift>[] }> = {}) => ({
  staffId: STAFF,
  days: Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    ...(over[dayOfWeek] ?? { isEnabled: 0 as 0 | 1, shifts: [] as ReturnType<typeof shift>[] }),
  })),
});

describe("weeklyScheduleSchema", () => {
  it("accepts split shifts on an open day and closed days with no shifts", () => {
    const r = weeklyScheduleSchema.safeParse(
      week({ 1: { isEnabled: 1, shifts: [shift("09:00", "12:00"), shift("14:00", "17:00")] } }),
    );
    expect(r.success).toBe(true);
  });
  it("rejects an open day with no shifts", () => {
    expect(weeklyScheduleSchema.safeParse(week({ 1: { isEnabled: 1, shifts: [] } })).success).toBe(false);
  });
  it("rejects overlapping and backwards shifts", () => {
    expect(
      weeklyScheduleSchema.safeParse(
        week({ 1: { isEnabled: 1, shifts: [shift("09:00", "13:00"), shift("12:00", "17:00")] } }),
      ).success,
    ).toBe(false);
    expect(
      weeklyScheduleSchema.safeParse(week({ 1: { isEnabled: 1, shifts: [shift("17:00", "09:00")] } })).success,
    ).toBe(false);
  });
  it("allows touching shifts", () => {
    expect(
      weeklyScheduleSchema.safeParse(
        week({ 1: { isEnabled: 1, shifts: [shift("09:00", "12:00"), shift("12:00", "17:00")] } }),
      ).success,
    ).toBe(true);
  });
  it("rejects more than 4 shifts, bad times, a bad location, and a missing day", () => {
    const five = [shift("06:00", "07:00"), shift("08:00", "09:00"), shift("10:00", "11:00"), shift("12:00", "13:00"), shift("14:00", "15:00")];
    expect(weeklyScheduleSchema.safeParse(week({ 1: { isEnabled: 1, shifts: five } })).success).toBe(false);
    expect(weeklyScheduleSchema.safeParse(week({ 1: { isEnabled: 1, shifts: [shift("9:00", "17:00")] } })).success).toBe(false);
    expect(
      weeklyScheduleSchema.safeParse(
        week({ 1: { isEnabled: 1, shifts: [{ startTime: "09:00", endTime: "17:00", locationId: "nope" }] } }),
      ).success,
    ).toBe(false);
    const missing = week();
    missing.days.pop();
    expect(weeklyScheduleSchema.safeParse(missing).success).toBe(false);
  });
  it("rejects a repeated day", () => {
    const dup = week();
    dup.days[6].dayOfWeek = 0;
    expect(weeklyScheduleSchema.safeParse(dup).success).toBe(false);
  });
});

describe("overrideSchema", () => {
  const base = { staffId: STAFF, date: "2026-06-17", reason: null };
  it("accepts a closed day with no shifts", () => {
    expect(overrideSchema.safeParse({ ...base, closed: true, shifts: [] }).success).toBe(true);
  });
  it("accepts special hours with valid shifts", () => {
    expect(overrideSchema.safeParse({ ...base, closed: false, shifts: [shift("10:00", "12:00")] }).success).toBe(true);
  });
  it("rejects an open override with no shifts or invalid shifts", () => {
    expect(overrideSchema.safeParse({ ...base, closed: false, shifts: [] }).success).toBe(false);
    expect(overrideSchema.safeParse({ ...base, closed: false, shifts: [shift("12:00", "10:00")] }).success).toBe(false);
  });
  it("rejects a bad date and a note over 200 characters", () => {
    expect(overrideSchema.safeParse({ ...base, date: "06/17/2026", closed: true, shifts: [] }).success).toBe(false);
    expect(overrideSchema.safeParse({ ...base, closed: true, shifts: [], reason: "x".repeat(201) }).success).toBe(false);
  });
});
