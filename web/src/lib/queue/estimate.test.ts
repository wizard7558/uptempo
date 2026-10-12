import { describe, it, expect } from "vitest";
import { estimateQueue, pickServiceMinutes, roundUpTo5, type QueueStaff } from "./estimate";

const at = (hhmm: string) => new Date(`2026-06-17T${hhmm}:00Z`);
const win = (a: string, b: string) => ({ start: at(a), end: at(b) });

describe("roundUpTo5", () => {
  it("rounds up to the next multiple of 5 and never goes below 0", () => {
    expect(roundUpTo5(0)).toBe(0);
    expect(roundUpTo5(0.1)).toBe(5);
    expect(roundUpTo5(5)).toBe(5);
    expect(roundUpTo5(11)).toBe(15);
    expect(roundUpTo5(-3)).toBe(0);
  });
});

describe("pickServiceMinutes", () => {
  it("uses the rounded mean with 3 or more samples", () => {
    expect(pickServiceMinutes([30, 40, 50], 45)).toBe(40);
  });
  it("falls back with fewer than 3 samples", () => {
    expect(pickServiceMinutes([30, 40], 45)).toBe(45);
    expect(pickServiceMinutes([], 30)).toBe(30);
  });
  it("clamps to 5..480", () => {
    expect(pickServiceMinutes([2, 2, 2], 45)).toBe(5);
    expect(pickServiceMinutes([900, 900, 900], 45)).toBe(480);
  });
});

describe("estimateQueue", () => {
  it("assigns each job to the earliest eligible person, ties to lower order", () => {
    const staff: QueueStaff[] = [
      { id: "A", order: 0, free: [win("10:00", "12:00")] },
      { id: "B", order: 1, free: [win("10:30", "12:00")] },
    ];
    const res = estimateQueue(at("10:00"), staff, [
      { id: "j1", minutes: 30, staffIds: ["A", "B"] },
      { id: "j2", minutes: 30, staffIds: ["A", "B"] },
      { id: "j3", minutes: 30, staffIds: ["B"] },
      { id: "j4", minutes: 45, staffIds: ["A", "B"] },
    ]);
    expect(res.map((r) => r.waitMinutes)).toEqual([0, 30, 30, 60]);
    expect(res.map((r) => r.staffId)).toEqual(["A", "A", "B", "A"]);
  });

  it("returns null when nobody has a long enough window", () => {
    const staff: QueueStaff[] = [{ id: "A", order: 0, free: [win("10:00", "10:20")] }];
    const [r] = estimateQueue(at("10:00"), staff, [{ id: "j", minutes: 30, staffIds: ["A"] }]);
    expect(r).toEqual({ id: "j", staffId: null, start: null, waitMinutes: null });
  });

  it("skips a window that is too short and uses the next one", () => {
    const staff: QueueStaff[] = [
      { id: "A", order: 0, free: [win("10:00", "10:20"), win("11:00", "12:00")] },
    ];
    const [r] = estimateQueue(at("10:00"), staff, [{ id: "j", minutes: 30, staffIds: ["A"] }]);
    expect(r.waitMinutes).toBe(60);
    expect(r.start).toEqual(at("11:00"));
  });

  it("starts no earlier than now and rounds the wait up to 5", () => {
    const now = at("10:02");
    const a = estimateQueue(now, [{ id: "A", order: 0, free: [win("10:00", "12:00")] }], [
      { id: "j", minutes: 30, staffIds: ["A"] },
    ]);
    expect(a[0].waitMinutes).toBe(0);
    const b = estimateQueue(now, [{ id: "A", order: 0, free: [win("10:13", "12:00")] }], [
      { id: "j", minutes: 30, staffIds: ["A"] },
    ]);
    expect(b[0].waitMinutes).toBe(15);
  });

  it("does not mutate the input windows", () => {
    const free = [win("10:00", "12:00")];
    estimateQueue(at("10:00"), [{ id: "A", order: 0, free }], [{ id: "j", minutes: 30, staffIds: ["A"] }]);
    expect(free).toEqual([win("10:00", "12:00")]);
  });

  it("ignores staff ids that are not in the pool", () => {
    const [r] = estimateQueue(at("10:00"), [{ id: "A", order: 0, free: [win("10:00", "12:00")] }], [
      { id: "j", minutes: 30, staffIds: ["Z"] },
    ]);
    expect(r.waitMinutes).toBeNull();
  });
});
