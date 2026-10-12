import { describe, expect, it } from "vitest";
import { VERTICALS } from "@/lib/verticals";
import { teamRoleLabel } from "./role-label";

describe("teamRoleLabel", () => {
  it("shows the tenant's staff word for provider and legacy stylist roles", () => {
    const barber = VERTICALS.barber.terms.staff.one;
    expect(teamRoleLabel("provider", barber)).toBe("Barber");
    expect(teamRoleLabel("stylist", barber)).toBe("Barber");
    expect(teamRoleLabel("provider", VERTICALS.hair_salon.terms.staff.one)).toBe(
      "Stylist",
    );
  });

  it("capitalizes other roles and never shows the raw provider value", () => {
    expect(teamRoleLabel("admin", "Barber")).toBe("Admin");
    expect(teamRoleLabel("assistant", "Barber")).toBe("Assistant");
    expect(teamRoleLabel("owner", "Barber")).toBe("Owner");
    expect(teamRoleLabel("provider", "Barber")).not.toBe("provider");
  });
});
