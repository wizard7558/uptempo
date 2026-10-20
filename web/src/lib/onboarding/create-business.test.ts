import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VerticalId } from "@/lib/verticals";

const h = vi.hoisted(() => ({
  signUpEmail: vi.fn(),
  getTenantBySlug: vi.fn(),
  insertMembership: vi.fn(),
  trackEvent: vi.fn(),
  identifyUser: vi.fn(),
  newTenantShard: vi.fn(() => "test-shard"),
  publicDb: {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ publicDb: h.publicDb }));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { signUpEmail: h.signUpEmail } },
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: h.getTenantBySlug,
}));
vi.mock("@/lib/analytics/events", () => ({
  trackEvent: h.trackEvent,
  identifyUser: h.identifyUser,
}));
vi.mock("@/lib/db/membership-helpers", () => ({
  insertMembership: h.insertMembership,
}));
vi.mock("@/lib/db/shards", () => ({
  newTenantShard: h.newTenantShard,
}));

import { createBusinessAccount } from "./create-business";

function signupData(industry: string) {
  return {
    businessName: "Example business",
    timezone: "America/Los_Angeles",
    ownerName: "Ada",
    email: "ada@example.com",
    password: "password1",
    industry: industry as VerticalId,
  };
}

function expectNoBusinessWritesOrAnalytics() {
  expect(h.publicDb.insert).not.toHaveBeenCalled();
  expect(h.publicDb.update).not.toHaveBeenCalled();
  expect(h.publicDb.delete).not.toHaveBeenCalled();
  expect(h.insertMembership).not.toHaveBeenCalled();
  expect(h.trackEvent).not.toHaveBeenCalled();
  expect(h.identifyUser).not.toHaveBeenCalled();
  expect(h.newTenantShard).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getTenantBySlug.mockResolvedValue(null);
  h.signUpEmail.mockRejectedValue("mock signup failure");
});

describe("createBusinessAccount error copy", () => {
  it.each([
    ["hair_salon", "Failed to create salon account"],
    ["barber", "Failed to create shop account"],
    ["nail_salon", "Failed to create salon account"],
    ["tattoo", "Failed to create studio account"],
    ["massage_wellness", "Failed to create studio account"],
    ["personal_training", "Failed to create gym account"],
    ["home_services", "Failed to create service area account"],
    ["general", "Failed to create location account"],
    ["future_runtime_industry", "Failed to create location account"],
  ])("uses the %s terms for non-Error signup failures", async (industry, expectedError) => {
    const result = await createBusinessAccount(signupData(industry));

    expect(result).toEqual({ success: false, error: expectedError });
    expect(h.getTenantBySlug).toHaveBeenCalledWith("example-business");
    expect(h.signUpEmail).toHaveBeenCalledWith({
      body: { name: "Ada", email: "ada@example.com", password: "password1" },
    });
    expectNoBusinessWritesOrAnalytics();
  });

  it("preserves Error messages", async () => {
    h.signUpEmail.mockRejectedValue(new Error("Authentication unavailable"));

    await expect(createBusinessAccount(signupData("tattoo"))).resolves.toEqual({
      success: false,
      error: "Authentication unavailable",
    });
    expectNoBusinessWritesOrAnalytics();
  });

  it("preserves the existing duplicate-email message for uniqueness errors", async () => {
    h.signUpEmail.mockRejectedValue(new Error("duplicate UNIQUE constraint"));

    await expect(createBusinessAccount(signupData("tattoo"))).resolves.toEqual({
      success: false,
      error: "An account with this email already exists",
    });
    expectNoBusinessWritesOrAnalytics();
  });
});
