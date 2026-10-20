// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  singleMode: false,
  selectedRows: [{ listed: 1 }],
  requireStaff: vi.fn(),
  requireRole: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@/lib/auth/rbac", () => ({
  AuthError: class AuthError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  requireRole: h.requireRole,
  requireStaff: h.requireStaff,
}));
vi.mock("@/lib/config/mode", () => ({
  isSingleMode: () => h.singleMode,
}));
vi.mock("@/lib/db/schema", () => ({
  tenants: {
    listedInMarketplace: "listedInMarketplace",
    slug: "slug",
    updatedAt: "updatedAt",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ column, value }),
}));
vi.mock("@/lib/db", () => ({
  publicDb: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => h.selectedRows),
        })),
      })),
    })),
    update: h.update,
  },
}));

import { getMarketplaceListing, setMarketplaceListing } from "./marketplace";

beforeEach(() => {
  vi.clearAllMocks();
  h.singleMode = false;
  h.selectedRows = [{ listed: 1 }];
  h.requireStaff.mockResolvedValue({
    userId: "staff-1",
    role: "owner",
    tenantSlug: "business-one",
  });
  h.requireRole.mockResolvedValue({
    userId: "owner-1",
    role: "owner",
    tenantSlug: "business-one",
  });
  h.updateWhere.mockResolvedValue(undefined);
  h.updateSet.mockImplementation(() => ({ where: h.updateWhere }));
  h.update.mockImplementation(() => ({ set: h.updateSet }));
});

describe("marketplace listing actions", () => {
  it("requires staff authentication and returns false in single mode without querying", async () => {
    h.singleMode = true;

    await expect(getMarketplaceListing()).resolves.toBe(false);

    expect(h.requireStaff).toHaveBeenCalledTimes(1);
    const { publicDb } = await import("@/lib/db");
    expect(publicDb.select).not.toHaveBeenCalled();
  });

  it("refuses owner updates in single mode without writing", async () => {
    h.singleMode = true;

    await expect(setMarketplaceListing(true)).rejects.toThrow(
      "Not available on this install.",
    );

    expect(h.requireRole).toHaveBeenCalledWith("owner");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("keeps owner listing updates in multi mode", async () => {
    await expect(setMarketplaceListing(true)).resolves.toEqual({ success: true });

    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ listedInMarketplace: 1 }),
    );
    expect(h.updateWhere).toHaveBeenCalledWith({
      column: "slug",
      value: "business-one",
    });
  });

  it("does not write when owner authorization fails", async () => {
    const authorizationError = new Error("unauthorized");
    h.requireRole.mockRejectedValueOnce(authorizationError);

    await expect(setMarketplaceListing(true)).rejects.toBe(authorizationError);

    expect(h.update).not.toHaveBeenCalled();
  });
});
