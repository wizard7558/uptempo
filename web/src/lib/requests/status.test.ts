import { describe, expect, it } from "vitest";
import { canTransitionRequest, type RequestStatus } from "./status";

const allowed: [RequestStatus, RequestStatus][] = [
  ["new", "reviewing"],
  ["new", "quoted"],
  ["reviewing", "quoted"],
  ["expired", "quoted"],
  ["quoted", "reviewing"],
  ["quoted", "expired"],
  ["new", "declined"],
  ["reviewing", "declined"],
  ["quoted", "declined"],
  ["quoted", "accepted"],
  ["accepted", "converted"],
  ["accepted", "quoted"],
];

describe("request transitions (D4)", () => {
  it.each(allowed)("%s -> %s is allowed", (from, to) => {
    expect(canTransitionRequest(from, to)).toBe(true);
  });

  it("does not let a booked request go back to quoted", () => {
    expect(canTransitionRequest("converted", "quoted")).toBe(false);
  });

  it("does not let declined or converted requests move at all", () => {
    for (const to of ["new", "reviewing", "quoted", "accepted", "declined", "converted", "expired"] as const) {
      expect(canTransitionRequest("declined", to)).toBe(false);
      expect(canTransitionRequest("converted", to)).toBe(false);
    }
  });

  it("does not accept a request that was never quoted", () => {
    expect(canTransitionRequest("new", "accepted")).toBe(false);
    expect(canTransitionRequest("reviewing", "accepted")).toBe(false);
  });
});
