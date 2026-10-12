import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({
  current: [] as Array<{ slug: string }>,
}));
const inserted = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("@/lib/db", () => ({
  publicDb: {
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: async () => rows.current,
        }),
      }),
    }),
    insert: () => ({
      values: async (row: unknown) => {
        inserted.current.push(row);
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    delete: () => ({ where: async () => {} }),
  },
}));
vi.mock("@/lib/db/schema/auth", () => ({ user: { id: "id" } }));
vi.mock("@/lib/db/schema/tenants", () => ({
  tenants: { slug: "slug", createdAt: "created_at" },
}));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      signUpEmail: vi.fn(async () => ({ user: { id: "user-1" } })),
    },
  },
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: vi.fn(async () => null),
}));
vi.mock("@/lib/analytics/events", () => ({
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
}));
vi.mock("@/lib/db/membership-helpers", () => ({
  insertMembership: vi.fn(async () => {}),
}));

import { createSingleBusiness } from "./setup";
import { clearSingleTenantSlugCache } from "@/lib/tenant/single";

const input = {
  businessName: "Smoke Test Studio",
  industry: "barber",
  timezone: "America/Chicago",
  ownerName: "Ada",
  email: "ada@example.com",
  password: "password1",
};

beforeEach(() => {
  rows.current = [];
  inserted.current = [];
  clearSingleTenantSlugCache();
  vi.unstubAllEnvs();
});

describe("createSingleBusiness", () => {
  it("rejects hosted signup when the install is multi", async () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    await expect(createSingleBusiness(input)).resolves.toEqual({
      success: false,
      error: "Sign-up is turned off on this install.",
    });
    expect(inserted.current).toEqual([]);
  });

  it("rejects a second business", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    rows.current = [{ slug: "already" }];
    await expect(createSingleBusiness(input)).resolves.toEqual({
      success: false,
      error: "A business is already set up.",
    });
    expect(inserted.current).toEqual([]);
  });

  it("stores the industry and the pack modules", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    await expect(createSingleBusiness(input)).resolves.toEqual({
      success: true,
      slug: "smoke-test-studio",
    });
    expect(inserted.current[0]).toMatchObject({
      name: "Smoke Test Studio",
      slug: "smoke-test-studio",
      industry: "barber",
      modules: ["memberships", "walk_in_queue", "slot_waitlist", "gift_cards"],
    });
  });
});
