import { describe, expect, it } from "vitest";
import { ageOn, requiredMinAge } from "./age";

describe("ageOn", () => {
  it("is 18 on the 18th birthday and 17 the day before", () => {
    expect(ageOn("2008-06-17", "2026-06-17")).toBe(18);
    expect(ageOn("2008-06-17", "2026-06-16")).toBe(17);
  });

  it("counts a Feb 29 birthday as Mar 1 in a non-leap year", () => {
    expect(ageOn("2004-02-29", "2022-02-28")).toBe(17);
    expect(ageOn("2004-02-29", "2022-03-01")).toBe(18);
  });

  it("uses Feb 29 itself in a leap year", () => {
    expect(ageOn("2004-02-29", "2024-02-28")).toBe(19);
    expect(ageOn("2004-02-29", "2024-02-29")).toBe(20);
  });

  it("handles the year boundary", () => {
    expect(ageOn("2000-12-31", "2026-01-01")).toBe(25);
    expect(ageOn("2000-01-01", "2026-01-01")).toBe(26);
  });
});

describe("requiredMinAge", () => {
  it("takes the largest minimum age", () => {
    expect(
      requiredMinAge([
        { kind: "consent", minAge: 16, isActive: 1 },
        { kind: "consent", minAge: 21, isActive: 1 },
        { kind: "consent", minAge: 18, isActive: 1 },
      ]),
    ).toBe(21);
  });

  it("skips inactive templates, other kinds and templates without a minimum", () => {
    expect(
      requiredMinAge([
        { kind: "consent", minAge: 21, isActive: 0 },
        { kind: "waiver", minAge: 21, isActive: 1 },
        { kind: "consent", minAge: null, isActive: 1 },
        { kind: "consent", minAge: 18, isActive: 1 },
      ]),
    ).toBe(18);
  });

  it("is null when nothing sets one", () => {
    expect(requiredMinAge([])).toBeNull();
    expect(requiredMinAge([{ kind: "consent", minAge: null, isActive: 1 }])).toBeNull();
  });
});
