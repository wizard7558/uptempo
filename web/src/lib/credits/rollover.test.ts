import { describe, it, expect } from "vitest";
import { periodRollover } from "./rollover";

describe("periodRollover", () => {
  it("expires what is above the carry-over limit, then grants the monthly amount", () => {
    expect(periodRollover(5, 4, 8)).toEqual({ expire: 1, grant: 8 });
  });

  it("expires a large unused balance down to the limit", () => {
    expect(periodRollover(12, 4, 8)).toEqual({ expire: 8, grant: 8 });
  });

  it("expires nothing when the balance is empty", () => {
    expect(periodRollover(0, 4, 8)).toEqual({ expire: 0, grant: 8 });
  });
});
