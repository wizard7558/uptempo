import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

const h = vi.hoisted(() => {
  const state: {
    role: string | null;
    tenant: Record<string, unknown> | null;
    servicesCount: number;
    hoursCount: number;
    requireCardOnFile: number;
    industry: "hair_salon" | "barber" | "tattoo";
    inserted: unknown[];
    existingSlugs: Set<string>;
  } = {
    role: "owner",
    tenant: null,
    servicesCount: 1,
    hoursCount: 1,
    requireCardOnFile: 1,
    industry: "hair_salon",
    inserted: [],
    existingSlugs: new Set<string>(),
  };

  const updateTenantOnboardingSteps = vi.fn(async () => {});
  const policyUpdateSet = vi.fn(() => ({ where: vi.fn(async () => {}) }));
  const revalidateTag = vi.fn();
  const revalidatePath = vi.fn();
  const trackEvent = vi.fn();

  return {
    state,
    updateTenantOnboardingSteps,
    policyUpdateSet,
    revalidateTag,
    revalidatePath,
    trackEvent,
    inserted: state.inserted,
  };
});

// Server translator without a request scope; words follow h.state.industry.
vi.mock("@/lib/terms/server", async () => {
  const { createTermsT } = await import("@/lib/terms/translator");
  const { VERTICALS } = await import("@/lib/verticals");
  return {
    getT: async (namespace?: string) =>
      createTermsT(VERTICALS[h.state.industry].terms, namespace ?? ""),
  };
});
vi.mock("@/lib/db", () => {
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ tenantSlug: "salon-x" }],
        }),
      }),
    }),
    insert: () => ({
      values: async (row: unknown) => {
        h.inserted.push(row);
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  return { publicDb: database, db: database };
});
vi.mock("@/lib/db/schema/auth", () => ({ user: { tenantSlug: "tenant_slug" } }));
vi.mock("@/lib/db/schema/tenants", () => ({ tenants: {} }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: { id: "u1" } })),
      signUpEmail: vi.fn(async () => ({ user: { id: "new-user" } })),
    },
  },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({
  revalidateTag: h.revalidateTag,
  revalidatePath: h.revalidatePath,
  unstable_cache: (fn: () => unknown) => fn,
}));
const ensureHostedSubscription = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/billing/subscriptions", () => ({ ensureHostedSubscription }));
vi.mock("@/lib/tenant/provision", () => ({ provisionTenantSchema: vi.fn() }));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: vi.fn(async (slug: string) => {
    if (slug === "salon-x") return h.state.tenant;
    return h.state.existingSlugs.has(slug) ? { slug } : null;
  }),
  updateTenantOnboardingSteps: h.updateTenantOnboardingSteps,
}));
vi.mock("@/lib/tenant/slug-validation", () => ({ slugSchema: { safeParse: vi.fn() } }));
vi.mock("@/lib/onboarding/service-templates", () => ({ SERVICE_TEMPLATES: [] }));
vi.mock("@/lib/analytics/events", () => ({
  trackEvent: h.trackEvent,
  identifyUser: vi.fn(),
}));
vi.mock("@/lib/db/membership-helpers", () => ({
  addMembershipAndActivate: vi.fn(),
  insertMembership: vi.fn(),
  getMembershipRoleForActiveTenant: vi.fn(async () => h.state.role),
}));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: vi.fn(
    async (
      _slug: string,
      cb: (db: unknown, tables: Record<string, unknown>) => Promise<unknown>,
    ) => {
      // Emulate the two query shapes used by the actions under test.
      const db = {
        select: () => ({
          from: (table: unknown) => {
            const rows =
              table === TBL.services
                ? [{ count: h.state.servicesCount }]
                : table === TBL.workingHours
                  ? [{ count: h.state.hoursCount }]
                  : [{ id: "pol-1", requireCardOnFile: h.state.requireCardOnFile }];
            return Object.assign(Promise.resolve(rows), {
              limit: async () => rows,
            });
          },
        }),
        update: () => ({ set: h.policyUpdateSet }),
      };
      return cb(db, TBL);
    },
  ),
}));

const TBL = {
  services: { __t: "services" },
  workingHours: { __t: "working_hours" },
  businessSettings: { __t: "business_settings" },
};

import {
  createBusinessAccount,
  launchBusiness,
  markOnboardingStepComplete,
  skipStripeForNow,
} from "./onboarding";

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    slug: "salon-x",
    name: "Salon X",
    stripeConnectAccountId: null,
    onboardingSteps: { profile: true },
    ...overrides,
  };
}

describe("launchBusiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.role = "owner";
    h.state.industry = "hair_salon";
    h.state.tenant = tenant({ onboardingSteps: { profile: true, policies: true, stripeSkipped: true } });
    h.state.servicesCount = 1;
    h.state.hoursCount = 1;
  });

  it("launches when all prerequisites are met", async () => {
    const result = await launchBusiness();
    expect(result).toEqual({ success: true });
    const written = h.updateTenantOnboardingSteps.mock.calls[0] as unknown[];
    expect(written[1]).toMatchObject({ launched: true, policies: true });
    expect(h.revalidateTag).toHaveBeenCalled();
  });

  it.each([
    ["services", () => { h.state.servicesCount = 0; }],
    ["hours", () => { h.state.hoursCount = 0; }],
    ["policies", () => { h.state.tenant = tenant({ onboardingSteps: { stripeSkipped: true } }); }],
    ["payments", () => { h.state.tenant = tenant({ onboardingSteps: { policies: true } }); }],
  ] as const)("rejects with missing=%s", async (key, arrange) => {
    arrange();
    const result = await launchBusiness();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.missing).toContain(key);
    expect(h.updateTenantOnboardingSteps).not.toHaveBeenCalled();
  });

  it("accepts a connected Stripe account in place of a skip", async () => {
    h.state.tenant = tenant({
      stripeConnectAccountId: "acct_1",
      onboardingSteps: { policies: true },
    });
    expect((await launchBusiness()).success).toBe(true);
  });

  it.each(["stylist", "provider"])("rejects non-manager role %s", async (role) => {
    h.state.role = role;
    const result = await launchBusiness();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/owner/i);
    expect(h.updateTenantOnboardingSteps).not.toHaveBeenCalled();
  });

  it("says shop, not salon, for a barber tenant", async () => {
    h.state.role = "provider";
    h.state.industry = "barber";
    const result = await launchBusiness();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Only the shop owner can do this");
  });

  it("keeps the old salon text for hair_salon", async () => {
    h.state.role = "provider";
    const result = await launchBusiness();
    expect(result).toMatchObject({
      success: false,
      error: "Only the salon owner can do this",
    });
  });

  it("starts the hosted trial for the launching business after success", async () => {
    const result = await launchBusiness();
    expect(result).toEqual({ success: true });
    expect(ensureHostedSubscription).toHaveBeenCalledTimes(1);
    expect(ensureHostedSubscription).toHaveBeenCalledWith("salon-x", {
      trialDays: 14,
    });
  });

  it("does not start a trial when launch is rejected", async () => {
    h.state.servicesCount = 0;
    await launchBusiness();
    expect(ensureHostedSubscription).not.toHaveBeenCalled();
  });

  it("still succeeds when the hosted subscription setup throws", async () => {
    ensureHostedSubscription.mockRejectedValueOnce(new Error("stripe down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await launchBusiness();
    expect(result).toEqual({ success: true });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("preserves unknown jsonb keys on write", async () => {
    h.state.tenant = tenant({
      onboardingSteps: { policies: true, stripeSkipped: true, futureKey: true },
    });
    await launchBusiness();
    const written = h.updateTenantOnboardingSteps.mock.calls[0] as unknown[];
    expect(written[1]).toMatchObject({ futureKey: true, launched: true });
  });
});

describe("createBusinessAccount", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    h.state.tenant = null;
    h.state.existingSlugs.clear();
    h.inserted.length = 0;
    vi.stubEnv("UPTEMPO_MODE", "multi");
  });

  it("is blocked in single mode", async () => {
    vi.stubEnv("UPTEMPO_MODE", "single");
    await expect(
      createBusinessAccount({
        businessName: "Ada Salon",
        timezone: "America/New_York",
        ownerName: "Ada",
        email: "ada@example.com",
        password: "password1",
        industry: "hair_salon",
      }),
    ).resolves.toEqual({
      success: false,
      error: "Sign-up is turned off on this install.",
    });
    vi.unstubAllEnvs();
  });

  it.each(["!!!", "東京"])(
    "uses the business slug fallback for %s and preserves its display name",
    async (businessName) => {
      const result = await createBusinessAccount({
        businessName,
        timezone: "America/New_York",
        ownerName: "Ada",
        email: "ada@example.com",
        password: "password1",
        industry: "hair_salon",
      });

      expect(result).toEqual({ success: true, slug: "business" });
      expect(h.inserted[0]).toMatchObject({ name: businessName, slug: "business" });
    },
  );

  it("adds a unique suffix when the business fallback slug is occupied", async () => {
    h.state.existingSlugs.add("business");

    const result = await createBusinessAccount({
      businessName: "!!!",
      timezone: "America/New_York",
      ownerName: "Ada",
      email: "ada@example.com",
      password: "password1",
      industry: "hair_salon",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.slug).toMatch(/^business-[a-z0-9]+$/);
      expect(h.state.existingSlugs.has(result.slug)).toBe(false);
      expect(h.inserted[0]).toMatchObject({ name: "!!!", slug: result.slug });
    }
  });
});

describe("skipStripeForNow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.role = "owner";
    h.state.tenant = tenant();
    h.state.requireCardOnFile = 1;
  });

  it("disables card-on-file when it was on and reports it", async () => {
    const result = await skipStripeForNow();
    expect(result).toEqual({ success: true, cardRequirementDisabled: true });
    expect(h.policyUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ requireCardOnFile: 0 }),
    );
    const written = h.updateTenantOnboardingSteps.mock.calls[0] as unknown[];
    expect(written[1]).toMatchObject({ stripeSkipped: true });
  });

  it("leaves card-on-file alone when already off", async () => {
    h.state.requireCardOnFile = 0;
    const result = await skipStripeForNow();
    expect(result).toEqual({ success: true, cardRequirementDisabled: false });
    expect(h.policyUpdateSet).not.toHaveBeenCalled();
  });

  it("refuses when Stripe is already connected", async () => {
    h.state.tenant = tenant({ stripeConnectAccountId: "acct_1" });
    const result = await skipStripeForNow();
    expect(result.success).toBe(false);
  });

  it("rejects non-manager roles", async () => {
    h.state.role = "assistant";
    expect((await skipStripeForNow()).success).toBe(false);
  });
});

describe("markOnboardingStepComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state.role = "owner";
    h.state.tenant = tenant();
  });

  it("rejects steps outside the allowlist", async () => {
    expect((await markOnboardingStepComplete("launched")).success).toBe(false);
    expect((await markOnboardingStepComplete("stripe")).success).toBe(false);
    expect(h.updateTenantOnboardingSteps).not.toHaveBeenCalled();
  });

  it("marks an allowlisted step for a manager", async () => {
    expect((await markOnboardingStepComplete("policies")).success).toBe(true);
    const written = h.updateTenantOnboardingSteps.mock.calls[0] as unknown[];
    expect(written[1]).toMatchObject({ policies: true });
  });

  it.each(["stylist", "provider"])("rejects non-manager role %s", async (role) => {
    h.state.role = role;
    expect((await markOnboardingStepComplete("policies")).success).toBe(false);
  });
});

describe("createBusinessAccount industry", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("UPTEMPO_MODE", "multi");
    vi.clearAllMocks();
    h.state.tenant = null;
    h.state.existingSlugs.clear();
    h.inserted.length = 0;
  });

  it("stores tattoo industry and the tattoo pack modules", async () => {
    const result = await createBusinessAccount({
      businessName: "Ink Room",
      timezone: "America/New_York",
      ownerName: "Ada",
      email: "ada@example.com",
      password: "password1",
      industry: "tattoo",
    });
    expect(result).toEqual({ success: true, slug: "ink-room" });
    const row = h.inserted[0] as { industry: string; modules: string[] };
    expect(row.industry).toBe("tattoo");
    expect(row.modules).toEqual([
      "requests",
      "projects",
      "consent_id",
      "slot_waitlist",
      "gift_cards",
      "attachments",
      "aftercare",
    ]);
  });
});
