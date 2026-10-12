import { describe, expect, it } from "vitest";

import { landingPathForRole } from "./landing";

describe("landingPathForRole", () => {
  it("sends owners and admins to the calendar", () => {
    expect(landingPathForRole("owner")).toBe("/schedule");
    expect(landingPathForRole("admin")).toBe("/schedule");
  });
  it("keeps other roles on the schedule", () => {
    expect(landingPathForRole("stylist")).toBe("/schedule");
    expect(landingPathForRole("provider")).toBe("/schedule");
    expect(landingPathForRole("assistant")).toBe("/schedule");
  });
  it("defaults to the schedule when the role is unknown", () => {
    expect(landingPathForRole(null)).toBe("/schedule");
    expect(landingPathForRole(undefined)).toBe("/schedule");
    expect(landingPathForRole("nonsense")).toBe("/schedule");
  });
});
