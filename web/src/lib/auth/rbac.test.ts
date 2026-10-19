import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const dbLimit = vi.fn();
const getRole = vi.fn();

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-tenant-slug": "spoofed-header-tenant" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  cache: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: (...a: unknown[]) => getSession(...a) } },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => dbLimit() }) }),
    }),
  },
}));
vi.mock("@/lib/db/membership-helpers", () => ({
  getMembershipRoleForActiveTenant: (...a: unknown[]) => getRole(...a),
}));

import { AuthError, requireStaff } from "./rbac";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AuthError);
    return (e as AuthError).code;
  }
  throw new Error("expected AuthError");
}

describe("requireStaff", () => {
  beforeEach(() => {
    getSession.mockReset();
    dbLimit.mockReset();
    getRole.mockReset();
  });

  it("throws UNAUTHENTICATED (no redirect) when there is no session", async () => {
    getSession.mockResolvedValue(null);
    expect(await codeOf(requireStaff())).toBe("UNAUTHENTICATED");
  });

  it("throws NO_TENANT when the user has no tenantSlug", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    dbLimit.mockResolvedValue([{ tenantSlug: null }]);
    expect(await codeOf(requireStaff())).toBe("NO_TENANT");
    expect(getRole).not.toHaveBeenCalled();
  });

  it("throws NO_TENANT for a blank tenantSlug", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    dbLimit.mockResolvedValue([{ tenantSlug: "  " }]);
    expect(await codeOf(requireStaff())).toBe("NO_TENANT");
  });

  it("throws FORBIDDEN when the user has no membership", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    dbLimit.mockResolvedValue([{ tenantSlug: "business-a" }]);
    getRole.mockResolvedValue(null);
    expect(await codeOf(requireStaff())).toBe("FORBIDDEN");
  });

  it("throws FORBIDDEN when the role is not in the allowed list", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    dbLimit.mockResolvedValue([{ tenantSlug: "business-a" }]);
    getRole.mockResolvedValue("provider");
    expect(await codeOf(requireStaff("owner", "admin"))).toBe("FORBIDDEN");
  });

  it("throws FORBIDDEN for a non-staff role value even with no roles given", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    dbLimit.mockResolvedValue([{ tenantSlug: "business-a" }]);
    getRole.mockResolvedValue("client");
    expect(await codeOf(requireStaff())).toBe("FORBIDDEN");
  });

  it("allows every TeamRole when called with no roles", async () => {
    for (const role of ["owner", "admin", "provider", "assistant"] as const) {
      getSession.mockResolvedValue({ user: { id: "u1" } });
      dbLimit.mockResolvedValue([{ tenantSlug: "business-a" }]);
      getRole.mockResolvedValue(role);
      await expect(requireStaff()).resolves.toEqual({
        userId: "u1",
        role,
        tenantSlug: "business-a",
      });
    }
  });

  it("treats a legacy stylist membership as provider", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    dbLimit.mockResolvedValue([{ tenantSlug: "business-a" }]);
    getRole.mockResolvedValue("stylist");
    await expect(requireStaff()).resolves.toEqual({
      userId: "u1",
      role: "provider",
      tenantSlug: "business-a",
    });
  });

  it("derives the tenant from the session user, never the x-tenant-slug header", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    dbLimit.mockResolvedValue([{ tenantSlug: "business-a" }]);
    getRole.mockResolvedValue("owner");
    const r = await requireStaff("owner");
    expect(r.tenantSlug).toBe("business-a");
    expect(getRole).toHaveBeenCalledWith("u1", "business-a");
  });
});
