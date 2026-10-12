import { describe, it, expect } from "vitest";
import { pickLeastLoaded } from "./any-staff";
import type { Slot } from "./types";

const slot = (staffId: string, iso: string, isFlex = false): Slot => ({
  start: new Date(iso),
  end: new Date(new Date(iso).getTime() + 3_600_000),
  staffId,
  resourceIds: [],
  isFlex,
  locationId: null,
});

describe("pickLeastLoaded", () => {
  it("returns nothing for no slots", () => {
    expect(pickLeastLoaded([], ["a"], {})).toEqual([]);
  });

  it("keeps one slot per start and sorts by start", () => {
    const out = pickLeastLoaded(
      [slot("a", "2026-06-17T15:00Z"), slot("b", "2026-06-17T14:00Z"), slot("b", "2026-06-17T15:00Z")],
      ["a", "b"],
      {},
    );
    expect(out.map((s) => s.start.toISOString())).toEqual([
      "2026-06-17T14:00:00.000Z",
      "2026-06-17T15:00:00.000Z",
    ]);
  });

  it("prefers the least-loaded person", () => {
    const out = pickLeastLoaded(
      [slot("a", "2026-06-17T14:00Z"), slot("b", "2026-06-17T14:00Z")],
      ["a", "b"],
      { a: 2, b: 0 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].staffId).toBe("b");
  });

  it("breaks ties by staff order, not input order", () => {
    const out = pickLeastLoaded(
      [slot("b", "2026-06-17T14:00Z"), slot("a", "2026-06-17T14:00Z")],
      ["a", "b"],
      { a: 1, b: 1 },
    );
    expect(out[0].staffId).toBe("a");
  });

  it("a regular slot beats a flex slot even when the flex person is less loaded", () => {
    const out = pickLeastLoaded(
      [slot("a", "2026-06-17T14:00Z", true), slot("b", "2026-06-17T14:00Z", false)],
      ["a", "b"],
      { a: 0, b: 5 },
    );
    expect(out[0].staffId).toBe("b");
    expect(out[0].isFlex).toBe(false);
  });

  it("uses a flex slot when it is the only one for that start", () => {
    const out = pickLeastLoaded([slot("a", "2026-06-17T14:00Z", true)], ["a"], {});
    expect(out[0].isFlex).toBe(true);
  });
});
