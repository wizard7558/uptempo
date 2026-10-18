import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { HOSTED_PLAN_PURPOSE } from "@/lib/billing/hosted-catalog";

const state = vi.hoisted(() => ({
  sets: [] as Record<string, unknown>[],
  rows: [{ slug: "test-salon" }] as unknown[],
}));

const stripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
}));
const withTenantDb = vi.hoisted(() => vi.fn());

vi.mock("@/lib/stripe/server", () => ({ getStripe: () => stripe }));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb }));
vi.mock("@/lib/db/schema", () => ({
  tenants: new Proxy({}, { get: (_t, c) => String(c) }),
}));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
  or: () => ({}),
}));
vi.mock("@/lib/db", () => ({
  publicDb: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.sets.push(values);
        return { where: () => ({ returning: async () => state.rows }) };
      },
    }),
  },
}));

import {
  handleHostedPlanEvent,
  HOSTED_PLAN_EVENT_TYPES,
} from "@/lib/billing/subscription-webhook";

const hostedMeta = { purpose: HOSTED_PLAN_PURPOSE, tenantSlug: "test-salon" };

function sub(status: string, metadata: Record<string, string> = hostedMeta) {
  return { id: "sub_1", status, metadata };
}

function event(
  type: string,
  object: unknown,
  extra: Record<string, unknown> = {},
): Stripe.Event {
  return { id: "evt_1", type, data: { object }, ...extra } as Stripe.Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sets = [];
  state.rows = [{ slug: "test-salon" }];
});

describe("handleHostedPlanEvent", () => {
  it("lists the hosted plan event types", () => {
    expect(HOSTED_PLAN_EVENT_TYPES).toContain("invoice.payment_failed");
    expect(HOSTED_PLAN_EVENT_TYPES).toContain("customer.subscription.resumed");
  });

  it("writes the retrieved status for a hosted subscription update", async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub("past_due"));
    const handled = await handleHostedPlanEvent(
      event("customer.subscription.updated", sub("active")),
    );
    expect(handled).toBe(true);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0]).toMatchObject({
      subscriptionStatus: "past_due",
      stripeSubscriptionId: "sub_1",
    });
    expect(withTenantDb).not.toHaveBeenCalled();
  });

  it("retrieves via the invoice subscription id on invoice.payment_failed", async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub("past_due"));
    const handled = await handleHostedPlanEvent(
      event("invoice.payment_failed", { id: "in_1", subscription: "sub_1" }),
    );
    expect(handled).toBe(true);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(state.sets[0]).toMatchObject({ subscriptionStatus: "past_due" });
    expect(withTenantDb).not.toHaveBeenCalled();
  });

  it("returns false for an invoice with no subscription", async () => {
    expect(
      await handleHostedPlanEvent(event("invoice.paid", { id: "in_1" })),
    ).toBe(false);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("leaves membership subscriptions alone without retrieving", async () => {
    const membership = sub("active", {
      purpose: "beauty_bank_membership",
      tenantSlug: "test-salon",
    });
    const handled = await handleHostedPlanEvent(
      event("customer.subscription.updated", membership),
    );
    expect(handled).toBe(false);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(state.sets).toHaveLength(0);
    expect(withTenantDb).not.toHaveBeenCalled();
  });

  it("leaves a membership invoice alone after retrieving its subscription", async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(
      sub("active", { purpose: "beauty_bank_membership", tenantSlug: "t" }),
    );
    const handled = await handleHostedPlanEvent(
      event("invoice.paid", { id: "in_1", subscription: "sub_1" }),
    );
    expect(handled).toBe(false);
    expect(state.sets).toHaveLength(0);
    expect(withTenantDb).not.toHaveBeenCalled();
  });

  it("ignores unrelated event types without calling Stripe", async () => {
    expect(
      await handleHostedPlanEvent(
        event("payment_intent.succeeded", { id: "pi_1" }),
      ),
    ).toBe(false);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(state.sets).toHaveLength(0);
  });

  it("ignores Connect events", async () => {
    expect(
      await handleHostedPlanEvent(
        event("customer.subscription.updated", sub("active"), {
          account: "acct_1",
        }),
      ),
    ).toBe(false);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(state.sets).toHaveLength(0);
  });

  it("falls back to the event object when retrieve fails on a deletion", async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(new Error("gone"));
    const handled = await handleHostedPlanEvent(
      event("customer.subscription.deleted", sub("canceled")),
    );
    expect(handled).toBe(true);
    expect(state.sets[0]).toMatchObject({ subscriptionStatus: "canceled" });
  });

  it("returns false for an invoice event when retrieve fails", async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(new Error("gone"));
    expect(
      await handleHostedPlanEvent(
        event("invoice.paid", { id: "in_1", subscription: "sub_1" }),
      ),
    ).toBe(false);
    expect(state.sets).toHaveLength(0);
  });

  it("returns false for a hosted subscription with no tenantSlug", async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(
      sub("active", { purpose: HOSTED_PLAN_PURPOSE }),
    );
    expect(
      await handleHostedPlanEvent(
        event("customer.subscription.created", sub("active", {})),
      ),
    ).toBe(false);
    expect(state.sets).toHaveLength(0);
  });

  it("still returns true and warns when no tenant row matched", async () => {
    state.rows = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripe.subscriptions.retrieve.mockResolvedValue(sub("active"));
    expect(
      await handleHostedPlanEvent(
        event("customer.subscription.updated", sub("active")),
      ),
    ).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
