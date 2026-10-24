import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  single: false,
  allowed: true,
  tenant: null as Record<string, unknown> | null,
  staffCount: 1,
}));

const stripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn(), update: vi.fn(), resume: vi.fn() },
  subscriptionItems: { create: vi.fn(), update: vi.fn(), del: vi.fn() },
  billingPortal: { sessions: { create: vi.fn() } },
}));

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/auth/rbac", () => ({
  requireStaff: async () => {
    if (!state.allowed) throw new Error("FORBIDDEN");
    return { userId: "u1", role: "owner", tenantSlug: "acme" };
  },
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: async () => state.tenant,
}));
vi.mock("@/lib/billing/billable-staff", () => ({
  countBillableStaff: async () => state.staffCount,
}));
vi.mock("@/lib/stripe/server", () => ({ getStripe: () => stripe }));

import { getHostedPlan, openBillingPortal } from "./hosted-billing";

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    slug: "acme",
    comped: 0,
    processingRateBps: null,
    smsLineStatus: "off",
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    platformStripeCustomerId: null,
    billingSwitchedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.single = false;
  state.allowed = true;
  state.staffCount = 1;
  state.tenant = tenant();
  stripe.subscriptions.retrieve.mockReset();
  stripe.billingPortal.sessions.create.mockReset();
  for (const mock of [
    stripe.subscriptions.update,
    stripe.subscriptions.resume,
    stripe.subscriptionItems.create,
    stripe.subscriptionItems.update,
    stripe.subscriptionItems.del,
  ]) {
    mock.mockReset();
  }
});

describe("getHostedPlan", () => {
  it("throws for a non-owner", async () => {
    state.allowed = false;
    await expect(getHostedPlan()).rejects.toThrow();
  });

  it("returns null in single mode without calling Stripe", async () => {
    state.single = true;
    state.tenant = tenant({ stripeSubscriptionId: "sub_1" });
    expect(await getHostedPlan()).toBeNull();
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("prices 3 billable staff at 2400 cents", async () => {
    state.staffCount = 3;
    const plan = await getHostedPlan();
    expect(plan?.billableStaff).toBe(3);
    expect(plan?.monthlyCents).toBe(2400);
    expect(plan?.smsLineStatus).toBe("off");
    expect(plan?.processingLabel).toBe("5%");
    expect(plan?.hasBillingAccount).toBe(false);
  });

  it.each([
    ["off", false, 1200],
    ["shared", false, 1200],
    ["pending", false, 1200],
    ["action_needed", false, 1200],
    ["active", true, 1600],
  ] as const)("reports %s line state and monthly text-line price", async (status, hasLine, cents) => {
    state.tenant = tenant({ smsLineStatus: status });
    const plan = await getHostedPlan();
    expect(plan?.smsLineStatus).toBe(status);
    expect(plan?.monthlyCents).toBe(cents);
  });

  it("includes a shared text line after the persisted billing switch", async () => {
    state.tenant = tenant({ smsLineStatus: "shared" });
    expect((await getHostedPlan())?.monthlyCents).toBe(1200);
    expect((await getHostedPlan())?.smsLineStatus).toBe("shared");

    state.tenant = tenant({
      smsLineStatus: "shared",
      billingSwitchedAt: new Date("2026-10-16T14:00:00.000Z"),
    });
    const switchedPlan = await getHostedPlan();
    expect(switchedPlan?.monthlyCents).toBe(1600);
    expect(switchedPlan?.smsLineStatus).toBe("shared");
  });

  it("reports the trial end for a trialing subscription", async () => {
    state.tenant = tenant({
      stripeSubscriptionId: "sub_1",
      platformStripeCustomerId: "cus_1",
      subscriptionStatus: "trialing",
    });
    stripe.subscriptions.retrieve.mockResolvedValue({
      status: "trialing",
      trial_end: 1_800_000_000,
    });
    const plan = await getHostedPlan();
    expect(plan?.trialEndsAt).toBe(new Date(1_800_000_000 * 1000).toISOString());
    expect(plan?.hasBillingAccount).toBe(true);
  });

  it("returns a null trial end when Stripe fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.tenant = tenant({ stripeSubscriptionId: "sub_1" });
    stripe.subscriptions.retrieve.mockRejectedValue(new Error("boom"));
    const plan = await getHostedPlan();
    expect(plan?.trialEndsAt).toBeNull();
    errorSpy.mockRestore();
  });

  it("reports a 0% processing label for a comped business", async () => {
    state.tenant = tenant({ comped: 1 });
    const plan = await getHostedPlan();
    expect(plan?.comped).toBe(true);
    expect(plan?.processingLabel).toBe("0%");
  });
});

describe("openBillingPortal", () => {
  it("throws for a non-owner", async () => {
    state.allowed = false;
    await expect(openBillingPortal()).rejects.toThrow();
  });

  it("errors in single mode without calling Stripe", async () => {
    state.single = true;
    expect(await openBillingPortal()).toEqual({
      error: "Couldn't open billing. Try again.",
    });
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it("errors without a billing account and does not call Stripe", async () => {
    const result = await openBillingPortal();
    expect("error" in result).toBe(true);
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it("creates a portal session returning to Settings, Billing", async () => {
    state.tenant = tenant({ platformStripeCustomerId: "cus_1" });
    stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.test/p/abc",
    });
    const result = await openBillingPortal();
    expect(result).toEqual({ url: "https://billing.stripe.test/p/abc" });
    const args = stripe.billingPortal.sessions.create.mock.calls[0][0];
    expect(args.customer).toBe("cus_1");
    expect(args.return_url.endsWith("/settings/billing")).toBe(true);
  });

  it("collects a card in the portal without ending a trial or attaching the text meter", async () => {
    state.tenant = tenant({
      platformStripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      subscriptionStatus: "trialing",
      smsLineStatus: "active",
    });
    stripe.billingPortal.sessions.create.mockResolvedValue({
      url: "https://billing.stripe.test/p/trial",
    });
    expect(await openBillingPortal()).toEqual({ url: "https://billing.stripe.test/p/trial" });
    expect(Object.keys(stripe.billingPortal.sessions.create.mock.calls[0][0]).sort()).toEqual([
      "customer",
      "return_url",
    ]);
    for (const mock of [
      stripe.subscriptions.update,
      stripe.subscriptions.resume,
      stripe.subscriptionItems.create,
      stripe.subscriptionItems.update,
      stripe.subscriptionItems.del,
    ]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("returns the error copy when Stripe fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.tenant = tenant({ platformStripeCustomerId: "cus_1" });
    stripe.billingPortal.sessions.create.mockRejectedValue(new Error("boom"));
    expect(await openBillingPortal()).toEqual({
      error: "Couldn't open billing. Try again.",
    });
    errorSpy.mockRestore();
  });
});
