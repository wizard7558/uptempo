import { describe, expect, it } from "vitest";
import { matchesCron } from "./cron";
import { JOBS } from "./registry";

function utc(iso: string): Date {
  return new Date(iso);
}

describe("matchesCron", () => {
  it("matches every registry schedule at its own minute and rejects a neighbor", () => {
    const cases: Record<string, { hit: string; miss: string }> = {
      "* * * * *": {
        hit: "2026-10-11T12:07:00.000Z",
        miss: "not-a-date",
      },
      "*/5 * * * *": {
        hit: "2026-10-11T12:05:00.000Z",
        miss: "2026-10-11T12:07:00.000Z",
      },
      "0 * * * *": {
        hit: "2026-10-11T12:00:00.000Z",
        miss: "2026-10-11T12:01:00.000Z",
      },
      "0 4 * * *": {
        hit: "2026-10-11T04:00:00.000Z",
        miss: "2026-10-11T05:00:00.000Z",
      },
      "0 2 * * 1": {
        hit: "2026-10-12T02:00:00.000Z",
        miss: "2026-10-11T02:00:00.000Z",
      },
      "0 6 1 * *": {
        hit: "2026-10-01T06:00:00.000Z",
        miss: "2026-10-02T06:00:00.000Z",
      },
      "30 3 * * *": {
        hit: "2026-10-11T03:30:00.000Z",
        miss: "2026-10-11T03:31:00.000Z",
      },
      "45 4 * * *": {
        hit: "2026-10-11T04:45:00.000Z",
        miss: "2026-10-11T04:44:00.000Z",
      },
      "15 4 * * *": {
        hit: "2026-10-11T04:15:00.000Z",
        miss: "2026-10-11T04:14:00.000Z",
      },
    };

    for (const job of JOBS) {
      const sample = cases[job.schedule];
      expect(sample, job.schedule).toBeTruthy();
      expect(matchesCron(job.schedule, utc(sample.hit)), job.id).toBe(true);
      if (job.schedule !== "* * * * *") {
        expect(matchesCron(job.schedule, utc(sample.miss)), job.id).toBe(false);
      }
    }
  });

  it("matches */5 at :00 and :05, Monday 02:00, and the 1st at 06:00", () => {
    expect(matchesCron("*/5 * * * *", utc("2026-10-11T00:00:00.000Z"))).toBe(true);
    expect(matchesCron("*/5 * * * *", utc("2026-10-11T00:05:00.000Z"))).toBe(true);
    expect(matchesCron("*/5 * * * *", utc("2026-10-11T00:04:00.000Z"))).toBe(false);
    expect(matchesCron("0 2 * * 1", utc("2026-10-12T02:00:00.000Z"))).toBe(true);
    expect(matchesCron("0 6 1 * *", utc("2026-10-01T06:00:00.000Z"))).toBe(true);
    expect(matchesCron("0 6 1 * *", utc("2026-10-01T06:01:00.000Z"))).toBe(false);
  });

  it("matches a list and a range", () => {
    expect(matchesCron("0,15 * * * *", utc("2026-10-11T09:15:00.000Z"))).toBe(true);
    expect(matchesCron("0,15 * * * *", utc("2026-10-11T09:14:00.000Z"))).toBe(false);
    expect(matchesCron("0 9-17 * * *", utc("2026-10-11T17:00:00.000Z"))).toBe(true);
    expect(matchesCron("0 9-17 * * *", utc("2026-10-11T18:00:00.000Z"))).toBe(false);
  });
});
