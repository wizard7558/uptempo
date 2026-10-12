import { describe, it, expect } from "vitest";
import { occurrenceStart, occurrencesBetween, parseRrule, toRrule, type RecurrenceShape } from "./rrule";

const NY = "America/New_York";
const rule = (over: Partial<RecurrenceShape> = {}): RecurrenceShape => ({
  rrule: toRrule(1),
  startsAt: new Date("2026-03-01T15:00:00Z"), // 10:00 EST
  until: null,
  count: null,
  timezone: NY,
  ...over,
});

const localHour = (d: Date) =>
  new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

describe("rrule text", () => {
  it("round trips the two supported rules", () => {
    expect(parseRrule(toRrule(1))).toEqual({ intervalWeeks: 1 });
    expect(parseRrule(toRrule(2))).toEqual({ intervalWeeks: 2 });
  });
  it("throws on anything else", () => {
    expect(() => parseRrule("FREQ=DAILY;INTERVAL=1")).toThrow();
  });
});

describe("occurrencesBetween", () => {
  const far = new Date("2027-01-01T00:00:00Z");
  it("weekly steps 7 days", () => {
    const occ = occurrencesBetween(rule(), new Date(0), new Date("2026-03-20T00:00:00Z"));
    expect(occ.map((o) => o.index)).toEqual([0, 1, 2]);
    expect(occ[1].start.toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });
  it("every 2 weeks steps 14 days", () => {
    const occ = occurrencesBetween(rule({ rrule: toRrule(2) }), new Date(0), new Date("2026-04-01T00:00:00Z"));
    expect(occ.map((o) => o.start.toISOString().slice(0, 10))).toEqual(["2026-03-01", "2026-03-15", "2026-03-29"]);
  });
  it("stops at count", () => {
    expect(occurrencesBetween(rule({ count: 4 }), new Date(0), far)).toHaveLength(4);
  });
  it("stops at until (inclusive)", () => {
    const occ = occurrencesBetween(rule({ until: new Date("2026-03-15T15:00:00Z") }), new Date(0), far);
    expect(occ.map((o) => o.index)).toEqual([0, 1, 2]);
  });
  it("excludes the after boundary and includes the through boundary", () => {
    const occ = occurrencesBetween(
      rule(),
      new Date("2026-03-01T15:00:00Z"),
      new Date("2026-03-15T15:00:00Z"),
    );
    expect(occ.map((o) => o.index)).toEqual([1, 2]);
  });
  it("caps runaway rules at 1000 iterations", () => {
    expect(occurrencesBetween(rule(), new Date(0), new Date("2200-01-01T00:00:00Z"))).toHaveLength(1000);
  });
});

describe("daylight saving", () => {
  it("keeps 10:00 local across the 2026-03-08 spring change", () => {
    const r = rule();
    const before = occurrenceStart(r, 0); // 2026-03-01
    const on = occurrenceStart(r, 1); // 2026-03-08
    expect(localHour(before)).toBe("10:00");
    expect(localHour(on)).toBe("10:00");
    expect(on.toISOString()).toBe("2026-03-08T14:00:00.000Z"); // EDT, one hour earlier in UTC
  });
  it("keeps 10:00 local across the 2026-11-01 fall change", () => {
    const r = rule({ startsAt: new Date("2026-10-25T14:00:00Z") }); // 10:00 EDT
    const on = occurrenceStart(r, 1); // 2026-11-01
    const after = occurrenceStart(r, 2);
    expect(localHour(on)).toBe("10:00");
    expect(localHour(after)).toBe("10:00");
    expect(after.toISOString()).toBe("2026-11-08T15:00:00.000Z"); // EST
  });
});
