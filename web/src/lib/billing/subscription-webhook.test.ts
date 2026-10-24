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
const reconcileHostedTextMeter = vi.hoisted(() => vi.fn());

vi.mock("@/lib/stripe/server", () => ({ getStripe: () => stripe }));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb }));
vi.mock("@/lib/db/schema", () => ({
  tenants: new Proxy({}, { get: (_t, c) => String(c) }),
}));
vi.mock("@/lib/billing/hosted-text-lifecycle", () => ({ reconcileHostedTextMeter }));
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
  classifyBoundary,
  handleHostedPlanEvent,
  HOSTED_PLAN_EVENT_TYPES,
  type LifecycleEvent,
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
  reconcileHostedTextMeter.mockReset().mockResolvedValue({ outcome: "free" });
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
    // The verified event is passed to the shared lifecycle as evidence.
    expect(reconcileHostedTextMeter).toHaveBeenCalledWith("test-salon", {
      event: expect.objectContaining({ id: "evt_1", type: "customer.subscription.updated" }),
    });
  });

  it.each(["customer.subscription.resumed", "customer.subscription.paused", "customer.subscription.created"])(
    "runs the shared lifecycle for %s after the status mirror",
    async (type) => {
      stripe.subscriptions.retrieve.mockResolvedValue(sub("active"));
      expect(await handleHostedPlanEvent(event(type, sub("active")))).toBe(true);
      expect(state.sets).toHaveLength(1);
      expect(reconcileHostedTextMeter).toHaveBeenCalledTimes(1);
    },
  );

  it("throws (Stripe retries) when a non-deletion event cannot be read fresh, without the event fallback", async () => {
    stripe.subscriptions.retrieve.mockRejectedValue(new Error("stripe down"));
    await expect(
      handleHostedPlanEvent(event("customer.subscription.resumed", sub("active"))),
    ).rejects.toThrow("stripe down");
    expect(state.sets).toHaveLength(0);
    expect(reconcileHostedTextMeter).not.toHaveBeenCalled();
  });

  it("propagates a hosted activation failure so the delivery is retried", async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(sub("active"));
    reconcileHostedTextMeter.mockRejectedValue(new Error("meter attach failed"));
    await expect(
      handleHostedPlanEvent(event("customer.subscription.updated", sub("active"))),
    ).rejects.toThrow("meter attach failed");
    reconcileHostedTextMeter.mockResolvedValue({ outcome: "pending", reason: "did_not_converge" });
    await expect(
      handleHostedPlanEvent(event("customer.subscription.updated", sub("active"))),
    ).rejects.toThrow(/did not converge/);
  });

  it.each([
    ["an invoice event", () => event("invoice.paid", { id: "in_1", subscription: "sub_1" }), sub("active")],
    ["a canceled subscription", () => event("customer.subscription.updated", sub("canceled")), sub("canceled")],
  ])("mirrors status but skips the lifecycle for %s", async (_name, make, retrieved) => {
    stripe.subscriptions.retrieve.mockResolvedValue(retrieved);
    expect(await handleHostedPlanEvent(make())).toBe(true);
    expect(state.sets).toHaveLength(1);
    expect(reconcileHostedTextMeter).not.toHaveBeenCalled();
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
    expect(reconcileHostedTextMeter).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("hosted text transition evidence (classifyBoundary)", () => {
  const ev = (type: string, created: number, extra: Partial<LifecycleEvent> = {}): LifecycleEvent => ({
    id: `evt_${type}_${created}`,
    type: `customer.subscription.${type}`,
    created,
    status: "active",
    previousStatus: null,
    trialEnd: 100,
    ...extra,
  });
  const s = (extra: Record<string, unknown> = {}) =>
    ({ status: "active", created: 10, trial_start: 10, trial_end: 100, ...extra }) as never;
  const conversion = ev("updated", 100, { previousStatus: "trialing" });
  const pause = ev("paused", 100, { status: "paused" });
  const resume = ev("resumed", 500);
  const persisted = { kind: "trial_end" as const, at: new Date(100_000), eventId: conversion.id };

  it("keeps trials and the initial missing-card pause free", () => {
    expect(classifyBoundary(s({ status: "trialing" }), [], null)).toEqual({ kind: "free" });
    expect(classifyBoundary(s({ status: "paused" }), [], null)).toEqual({ kind: "free" });
    expect(classifyBoundary(s({ status: "paused", trial_start: null, trial_end: null }), [], null))
      .toMatchObject({ kind: "unsupported" });
  });

  it("uses the completed trial_end, the resume event time, or no-trial creation", () => {
    expect(classifyBoundary(s(), [conversion], null)).toMatchObject({
      boundary: { kind: "trial_end", at: new Date(100_000), eventId: conversion.id },
    });
    expect(classifyBoundary(s(), [resume, pause], null)).toMatchObject({
      boundary: { kind: "resumed", at: new Date(500_000), eventId: resume.id },
    });
    expect(classifyBoundary(s({ trial_start: null, trial_end: null }), [], null)).toMatchObject({
      boundary: { kind: "created", at: new Date(10_000), eventId: null },
    });
  });

  it.each([
    ["a pause without its resume", [pause]],
    ["a resume without its pause", [resume]],
    ["no conversion evidence", []],
    ["incomplete history", null],
    ["a conversion for another trial_end", [{ ...conversion, trialEnd: 99 }]],
    ["a resume alongside a natural conversion", [pause, resume, conversion]],
  ])("leaves %s unresolved", (_name, events) => {
    expect(classifyBoundary(s(), events as LifecycleEvent[] | null, null)).toMatchObject({ kind: "unresolved" });
  });

  it("fails closed on repeated or later pauses and trusts only persisted facts once recorded", () => {
    expect(classifyBoundary(s({ status: "incomplete" }), [conversion], null)).toMatchObject({ kind: "unresolved" });
    expect(classifyBoundary(s(), [pause, resume, ev("paused", 600), ev("resumed", 700)], null))
      .toMatchObject({ kind: "unsupported" });
    expect(classifyBoundary(s({ status: "paused" }), [], persisted)).toMatchObject({ kind: "unsupported" });
    expect(classifyBoundary(s({ status: "trialing" }), [], persisted)).toMatchObject({ kind: "unsupported" });
    expect(classifyBoundary(s(), [ev("paused", 900), ev("resumed", 950)], persisted))
      .toMatchObject({ kind: "unsupported" });
    expect(classifyBoundary(s(), null, persisted)).toEqual({ kind: "unresolved", reason: "history_incomplete" });
    expect(classifyBoundary(s(), [pause], persisted)).toEqual({ kind: "boundary", boundary: persisted });
  });
});
