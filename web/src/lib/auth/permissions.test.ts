import { describe, expect, it } from "vitest";

import {
  LEGACY_PROVIDER_ROLE,
  hasPermission,
  normalizeTeamRole,
  requirePermission,
} from "./permissions";

describe("normalizeTeamRole", () => {
  it("maps the legacy stylist value to provider", () => {
    expect(LEGACY_PROVIDER_ROLE).toBe("stylist");
    expect(normalizeTeamRole("stylist")).toBe("provider");
  });
  it("leaves other roles unchanged", () => {
    for (const role of ["owner", "admin", "provider", "assistant", "client", ""]) {
      expect(normalizeTeamRole(role)).toBe(role);
    }
  });
});

describe("hasPermission", () => {
  it("accepts the legacy stylist role for manage_clients", () => {
    expect(hasPermission("stylist", "manage_clients")).toBe(true);
  });
  it("accepts provider for manage_clients and schedule permissions", () => {
    expect(hasPermission("provider", "manage_clients")).toBe(true);
    expect(hasPermission("provider", "manage_schedule")).toBe(true);
    expect(hasPermission("provider", "view_own_schedule")).toBe(true);
  });
  it("rejects assistant for manage_clients", () => {
    expect(hasPermission("assistant", "manage_clients")).toBe(false);
  });
  it("keeps provider out of owner/admin-only permissions", () => {
    expect(hasPermission("provider", "manage_staff")).toBe(false);
    expect(hasPermission("stylist", "view_revenue")).toBe(false);
  });
  it("requirePermission throws for a role lacking the permission", () => {
    expect(() => requirePermission("assistant", "manage_clients")).toThrow();
    expect(() => requirePermission("stylist", "manage_clients")).not.toThrow();
  });
});
