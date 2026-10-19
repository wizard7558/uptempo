import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLimit = vi.fn();

vi.mock("@/lib/db", () => ({
  publicDb: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockLimit,
        })),
      })),
    })),
  },
}));

import {
  getMembershipRoleForActiveTenant,
} from "./membership-helpers";

describe("getMembershipRoleForActiveTenant", () => {
  beforeEach(() => {
    mockLimit.mockReset();
  });

  it("returns null when tenant slug is null", async () => {
    expect(await getMembershipRoleForActiveTenant("user-1", null)).toBeNull();
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("returns null when tenant slug is empty or whitespace", async () => {
    expect(await getMembershipRoleForActiveTenant("user-1", "")).toBeNull();
    expect(await getMembershipRoleForActiveTenant("user-1", "   ")).toBeNull();
    expect(mockLimit).not.toHaveBeenCalled();
  });

  it("returns role from memberships row", async () => {
    mockLimit.mockResolvedValue([{ role: "admin" }]);
    expect(await getMembershipRoleForActiveTenant("user-1", "my-business")).toBe(
      "admin",
    );
  });

  it("returns null when no membership row", async () => {
    mockLimit.mockResolvedValue([]);
    expect(await getMembershipRoleForActiveTenant("user-1", "my-business")).toBeNull();
  });

  it("trims tenant slug before querying", async () => {
    mockLimit.mockResolvedValue([{ role: "provider" }]);
    expect(await getMembershipRoleForActiveTenant("user-1", "  my-business  ")).toBe(
      "provider",
    );
  });

  it("normalizes the legacy stylist role to provider", async () => {
    mockLimit.mockResolvedValue([{ role: "stylist" }]);
    expect(await getMembershipRoleForActiveTenant("user-1", "my-business")).toBe(
      "provider",
    );
  });
});
