import { describe, expect, it } from "vitest";
import { getVertical } from "@/lib/verticals";
import { mergeTerms, sanitizeModules } from "./industry";

describe("mergeTerms", () => {
  const base = getVertical("hair_salon").terms;

  it("returns the pack terms when there are no overrides", () => {
    expect(mergeTerms(base, {})).toEqual(base);
    expect(mergeTerms(base, null)).toEqual(base);
  });

  it("deep-merges partial overrides without losing sibling keys", () => {
    const merged = mergeTerms(base, {
      staff: { one: "Artist" },
      prepaidBalance: "Credit",
    });
    expect(merged.staff).toEqual({ one: "Artist", other: base.staff.other });
    expect(merged.prepaidBalance).toBe("Credit");
    expect(merged.customer).toEqual(base.customer);
  });

  it("ignores unknown keys and wrong-typed values, and does not mutate base", () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    const merged = mergeTerms(base, {
      bogus: { one: "x" },
      place: "not-an-object",
      booking: { one: 5, other: "" },
    });
    expect(merged).toEqual(base);
    expect(base).toEqual(snapshot);
  });
});

describe("sanitizeModules", () => {
  it("drops unknown ids, non-strings and duplicates", () => {
    expect(
      sanitizeModules(["memberships", "nope", 3, "memberships", "gift_cards"]),
    ).toEqual(["memberships", "gift_cards"]);
  });

  it("returns [] for non-arrays", () => {
    expect(sanitizeModules(null)).toEqual([]);
    expect(sanitizeModules({})).toEqual([]);
    expect(sanitizeModules("memberships")).toEqual([]);
  });
});

describe("unknown industry", () => {
  it("falls back to the general pack", () => {
    expect(getVertical("underwater_basket_weaving").id).toBe("general");
    expect(getVertical(undefined).id).toBe("general");
  });
});
