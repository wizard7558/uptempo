import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe/connect", () => ({
  createConnectAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  getConnectAccountStatus: vi.fn(),
}));
vi.mock("@/lib/tenant/context", () => ({ getTenantSlug: vi.fn() }));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: vi.fn(async () => ({
    stripeConnectAccountId: "acct_123",
    plan: "pro",
    platformFeePercent: null,
  })),
}));
vi.mock("@/lib/db", () => ({ publicDb: {} }));
vi.mock("@/lib/db/schema", () => ({ tenants: {}, webhookLookup: {} }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

import { getConnectChargeParams } from "@/lib/stripe/connect-charge-params";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getConnectChargeParams", () => {
  it("returns null in single mode", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    await expect(getConnectChargeParams("ada", 5_000)).resolves.toBeNull();
  });

  it("returns the Connect account and fee in multi mode", async () => {
    vi.stubEnv("UPTEMPO_MODE", "multi");
    await expect(getConnectChargeParams("ada", 5_000)).resolves.toEqual({
      connectAccountId: "acct_123",
      platformFeeCents: 50,
    });
  });
});
