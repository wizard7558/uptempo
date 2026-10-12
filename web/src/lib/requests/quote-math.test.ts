import { describe, expect, it } from "vitest";
import { formatDuration, LINE_MINUTE_OPTIONS, quoteTotals } from "./quote-math";

const words = { min: (n: number) => `${n} min`, hr: (n: number) => `${n} hr` };

describe("quoteTotals", () => {
  it("multiplies price by quantity and adds time once per line", () => {
    expect(
      quoteTotals([
        { quantity: 1, unitCents: 60000, minutes: 240 },
        { quantity: 2, unitCents: 5000, minutes: 30 },
      ]),
    ).toEqual({ subtotalCents: 70000, minutes: 270 });
  });
});

describe("formatDuration", () => {
  it.each([
    [30, "30 min"],
    [240, "4 hr"],
    [270, "4 hr 30 min"],
    [60, "1 hr"],
  ])("%i minutes reads %s", (m, text) => {
    expect(formatDuration(m, words)).toBe(text);
  });

  it("offers 15 to 600 minutes in steps of 15", () => {
    expect(LINE_MINUTE_OPTIONS[0]).toBe(15);
    expect(LINE_MINUTE_OPTIONS.at(-1)).toBe(600);
    expect(LINE_MINUTE_OPTIONS).toHaveLength(40);
  });
});
