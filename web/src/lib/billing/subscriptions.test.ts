import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_PLAN_PURPOSE,
  HOSTED_PRICES,
} from "@/lib/billing/hosted-catalog";
import * as pricing from "@/lib/billing/hosted-pricing";

const state = vi.hoisted(() => ({
  single: false,
  tenant: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  subscription: {} as Record<string, unknown>,
  customer: {} as Record<string, unknown>,
}));

const PRICE_IDS: Record<string, string> = {
  hosted_base_monthly: "price_base",
  hosted_extra_staff_monthly: "price_extra",
  hosted_text_line_monthly: "price_line",
  hosted_texts_metered: "price_texts",
};

const stripe = vi.hoisted(() => ({
  customers: {
    create: vi.fn(async () => ({ id: "cus_1" })),
    retrieve: vi.fn(),
    update: vi.fn(),
    retrieveSource: vi.fn(),
    search: vi.fn(async () => ({ data: [], has_more: false })),
    list: vi.fn(async () => ({ data: [], has_more: false })),
  },
  prices: {
    list: vi.fn(async (params: { lookup_keys: string[] }) => ({
      data: params.lookup_keys
        .filter((k) => k in PRICE_IDS)
        .map((k) => ({ id: PRICE_IDS[k], lookup_key: k })),
    })),
  },
  subscriptions: {
    create: vi.fn(async () => ({
      id: "sub_new",
      customer: "cus_1",
      status: "trialing",
      metadata: { tenantSlug: "test-salon", purpose: "uptempo_hosted_plan" },
    })),
    retrieve: vi.fn(async () => state.subscription),
    list: vi.fn(async () => ({ data: [], has_more: false })),
    update: vi.fn(),
    resume: vi.fn(),
  },
  subscriptionItems: {
    list: vi.fn(async () => ({ data: [], has_more: false })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  },
  paymentMethods: {
    retrieve: vi.fn(async (id: string) => ({
      id,
      customer: "cus_1",
      type: "card",
      card: { exp_month: 12, exp_year: 2099 },
    })),
  },
}));

vi.mock("@/lib/stripe/server", () => ({ getStripe: () => stripe }));
vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => state.single }));
vi.mock("@/lib/db/schema", () => ({
  tenants: new Proxy({}, { get: (_t, c) => String(c) }),
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("@/lib/db", () => ({
  publicDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.tenant ? [state.tenant] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.updates.push(values);
        return { where: async () => undefined };
      },
    }),
  },
}));

import {
  desiredItems,
  diffItems,
  ensureHostedCustomer,
  ensureHostedSubscription,
  resetHostedPriceCacheForTests,
  resolvePriceIds,
  syncHostedSubscription,
} from "@/lib/billing/subscriptions";

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    slug: "test-salon",
    name: "Test Salon",
    comped: 0,
    billableStaff: 1,
    billingSwitchedAt: new Date("2026-10-01T00:00:00.000Z"),
    platformStripeCustomerId: null,
    stripeSubscriptionId: null,
    ...overrides,
  };
}

function hostedSubscription(
  items: Array<Record<string, unknown>> = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: { tenantSlug: "test-salon", purpose: HOSTED_PLAN_PURPOSE },
    default_payment_method: null,
    default_source: null,
    items: { data: items, has_more: false },
    ...overrides,
  };
}

function writeCalls() {
  return (
    stripe.customers.create.mock.calls.length +
    stripe.subscriptions.create.mock.calls.length +
    stripe.subscriptionItems.create.mock.calls.length +
    stripe.subscriptionItems.update.mock.calls.length +
    stripe.subscriptionItems.del.mock.calls.length
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stripe.customers.create.mockReset().mockResolvedValue({ id: "cus_1" });
  stripe.customers.retrieve.mockReset().mockImplementation(async (id: string) => ({
    ...state.customer,
    id,
  } as never));
  stripe.customers.update.mockReset().mockImplementation(async (id: string, params: Record<string, unknown>) => ({
    ...state.customer,
    id,
    ...params,
  } as never));
  stripe.customers.retrieveSource.mockReset().mockResolvedValue({
    id: "src_1",
    object: "card",
    customer: "cus_1",
    exp_month: 12,
    exp_year: 2099,
  } as never);
  stripe.customers.search
    .mockReset()
    .mockResolvedValue({ data: [], has_more: false });
  stripe.customers.list
    .mockReset()
    .mockResolvedValue({ data: [], has_more: false });
  stripe.subscriptions.create.mockReset().mockResolvedValue({
    id: "sub_new",
    customer: "cus_1",
    status: "trialing",
    metadata: { tenantSlug: "test-salon", purpose: HOSTED_PLAN_PURPOSE },
  } as never);
  stripe.subscriptions.retrieve.mockReset().mockImplementation(async () => state.subscription as never);
  stripe.subscriptions.list.mockReset().mockResolvedValue({ data: [], has_more: false } as never);
  stripe.subscriptions.update.mockReset().mockImplementation(async (_id: string, params: Record<string, unknown>) => ({
    ...state.subscription,
    ...params,
  } as never));
  stripe.subscriptions.resume.mockReset().mockImplementation(async () => state.subscription as never);
  stripe.subscriptionItems.list.mockReset().mockResolvedValue({ data: [], has_more: false } as never);
  stripe.subscriptionItems.create.mockReset().mockResolvedValue({} as never);
  stripe.subscriptionItems.update.mockReset().mockResolvedValue({} as never);
  stripe.subscriptionItems.del.mockReset().mockResolvedValue({} as never);
  stripe.paymentMethods.retrieve.mockReset().mockImplementation(async (id: string) => ({
    id,
    customer: "cus_1",
    type: "card",
    card: { exp_month: 12, exp_year: 2099 },
  } as never));
  resetHostedPriceCacheForTests();
  state.single = false;
  state.tenant = tenant();
  state.updates = [];
  state.subscription = hostedSubscription();
  state.customer = {
    email: null,
    metadata: { tenantSlug: "test-salon", purpose: HOSTED_PLAN_PURPOSE },
    invoice_settings: { default_payment_method: null },
    default_source: null,
  };
});

const qty = (items: ReturnType<typeof desiredItems>, key: string) =>
  items.find((i) => i.lookupKey === key)?.quantity;

describe("desiredItems", () => {
  it.each([0, 1])("%i staff: base 1, extra 0", (n) => {
    const items = desiredItems({ billableStaff: n });
    expect(items).toHaveLength(2);
    expect(qty(items, "hosted_base_monthly")).toBe(1);
    expect(qty(items, "hosted_extra_staff_monthly")).toBe(0);
  });

  it("3 staff: extra 2", () => {
    expect(
      qty(desiredItems({ billableStaff: 3 }), "hosted_extra_staff_monthly"),
    ).toBe(2);
  });

  it("9 staff caps extra staff at 5", () => {
    expect(
      qty(desiredItems({ billableStaff: 9 }), "hosted_extra_staff_monthly"),
    ).toBe(5);
  });

  it("an active line adds the text line and metered texts", () => {
    const items = desiredItems({ billableStaff: 1, smsLineStatus: "active" });
    expect(qty(items, "hosted_text_line_monthly")).toBe(1);
    const metered = items.find((i) => i.lookupKey === "hosted_texts_metered");
    expect(metered).toEqual({ lookupKey: "hosted_texts_metered" });
  });

  it("shared without a switch adds nothing", () => {
    expect(
      desiredItems({ billableStaff: 1, smsLineStatus: "shared" }),
    ).toHaveLength(2);
    expect(
      desiredItems({
        billableStaff: 1,
        smsLineStatus: "shared",
        billingSwitched: false,
      }),
    ).toHaveLength(2);
  });

  it("shared plus switched adds both", () => {
    const keys = desiredItems({
      billableStaff: 1,
      smsLineStatus: "shared",
      billingSwitched: true,
    }).map((i) => i.lookupKey);
    expect(keys).toContain("hosted_text_line_monthly");
    expect(keys).toContain("hosted_texts_metered");
  });

  it("off and pending add nothing", () => {
    for (const s of ["off", "pending", "action_needed", null]) {
      expect(
        desiredItems({
          billableStaff: 1,
          smsLineStatus: s,
          billingSwitched: true,
        }),
      ).toHaveLength(2);
    }
  });
});

describe("resolvePriceIds", () => {
  it("throws naming the missing key and the catalog script", async () => {
    await expect(
      resolvePriceIds(["hosted_base_monthly", "hosted_text_line_setup"]),
    ).rejects.toThrow(/hosted_text_line_setup[\s\S]*ensure-hosted-catalog/);
  });

  it("caches ids per process", async () => {
    await resolvePriceIds(["hosted_base_monthly"]);
    await resolvePriceIds(["hosted_base_monthly"]);
    expect(stripe.prices.list).toHaveBeenCalledTimes(1);
  });
});

describe("ensureHostedSubscription", () => {
  it("creates the customer and subscription for 1 staff", async () => {
    const result = await ensureHostedSubscription("test-salon", {
      trialDays: 14,
    });
    expect(result).toEqual({ subscriptionId: "sub_new", status: "trialing" });

    expect(stripe.customers.create).toHaveBeenCalledWith(
      {
        name: "Test Salon",
        metadata: { tenantSlug: "test-salon", purpose: HOSTED_PLAN_PURPOSE },
      },
      {
        idempotencyKey: "hosted-customer:test-salon",
        timeout: 30_000,
        maxNetworkRetries: 0,
      },
    );
    expect(stripe.customers.list).toHaveBeenCalledTimes(1);
    expect(stripe.customers.search).toHaveBeenCalledWith(
      {
        query:
          "metadata['tenantSlug']:'test-salon' AND metadata['purpose']:'uptempo_hosted_plan'",
        limit: 100,
      },
      { timeout: 5_000, maxNetworkRetries: 0 },
    );
    const [params, options] = stripe.subscriptions.create.mock
      .calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(params).toMatchObject({
      customer: "cus_1",
      items: [
        { price: "price_base", quantity: 1 },
        { price: "price_extra", quantity: 0 },
      ],
      trial_period_days: 14,
      trial_settings: { end_behavior: { missing_payment_method: "pause" } },
      payment_settings: { save_default_payment_method: "on_subscription" },
      metadata: { purpose: HOSTED_PLAN_PURPOSE, tenantSlug: "test-salon" },
      collection_method: "charge_automatically",
    });
    expect(params).not.toHaveProperty("days_until_due");
    expect(options).toEqual({
      idempotencyKey: "hosted-sub:test-salon",
      timeout: 30_000,
      maxNetworkRetries: 0,
    });
    expect(state.updates).toContainEqual(
      expect.objectContaining({ platformStripeCustomerId: "cus_1" }),
    );
    expect(state.updates).toContainEqual(
      expect.objectContaining({
        stripeSubscriptionId: "sub_new",
        subscriptionStatus: "trialing",
      }),
    );
  });

  it("includes the hosted text line only for an active registered line", async () => {
    state.tenant = tenant({ smsLineStatus: "active" });
    await ensureHostedSubscription("test-salon", { trialDays: 0 });
    const [activeParams] = stripe.subscriptions.create.mock
      .calls[0] as unknown as [{ items: Array<{ price: string }> }];
    expect(activeParams.items.map((item) => item.price)).toContain(
      "price_line",
    );
    expect(activeParams.items.map((item) => item.price)).toContain(
      "price_texts",
    );

    vi.clearAllMocks();
    resetHostedPriceCacheForTests();
    state.tenant = tenant({ smsLineStatus: "shared", billingSwitchedAt: null });
    await ensureHostedSubscription("test-salon", { trialDays: 0 });
    const [sharedParams] = stripe.subscriptions.create.mock
      .calls[0] as unknown as [{ items: Array<{ price: string }> }];
    expect(sharedParams.items.map((item) => item.price)).not.toContain(
      "price_line",
    );
    expect(sharedParams.items.map((item) => item.price)).not.toContain(
      "price_texts",
    );
  });

  it("reuses an existing customer and omits the trial at 0 days", async () => {
    state.tenant = tenant({ platformStripeCustomerId: "cus_existing" });
    await ensureHostedSubscription("test-salon", { trialDays: 0 });
    expect(stripe.customers.create).not.toHaveBeenCalled();
    const [params] = stripe.subscriptions.create.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(params.customer).toBe("cus_existing");
    expect(params).not.toHaveProperty("trial_period_days");
  });

  it("does not create a trial subscription for a legacy tenant before its switch", async () => {
    state.tenant = tenant({ billingSwitchedAt: null });

    await expect(
      ensureHostedSubscription("test-salon", { trialDays: 14 }),
    ).resolves.toEqual({ skipped: "awaiting_switch" });

    expect(writeCalls()).toBe(0);
    expect(stripe.prices.list).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous customer-create response with a bounded metadata scan", async () => {
    stripe.customers.list
      .mockResolvedValueOnce({ data: [], has_more: false } as never)
      .mockResolvedValueOnce({
        data: [
          {
            id: "cus_recovered",
            metadata: { tenantSlug: "test-salon", purpose: HOSTED_PLAN_PURPOSE },
          },
        ],
        has_more: false,
      } as never);
    stripe.customers.create.mockRejectedValueOnce(
      new Error("ambiguous response"),
    );
    const result = await ensureHostedCustomer("test-salon");
    expect(result).toBe("cus_recovered");
    expect(stripe.customers.list).toHaveBeenLastCalledWith(
      { limit: 100 },
      { timeout: 5_000, maxNetworkRetries: 0 },
    );
    expect(stripe.customers.list).toHaveBeenCalledTimes(2);
    expect(state.updates).toContainEqual(
      expect.objectContaining({ platformStripeCustomerId: "cus_recovered" }),
    );
  });

  it("fails closed when bounded customer recovery cannot establish history", async () => {
    stripe.customers.list
      .mockResolvedValueOnce({ data: [], has_more: false } as never)
      .mockResolvedValueOnce({ data: [], has_more: true } as never);
    stripe.customers.create.mockRejectedValueOnce(
      new Error("ambiguous response"),
    );
    await expect(ensureHostedCustomer("test-salon")).rejects.toThrow(
      /history is unavailable/,
    );
    expect(stripe.customers.list).toHaveBeenCalledTimes(2);
    expect(state.updates).toHaveLength(0);
  });

  it("stops after 20 customer recovery pages rather than risking an overlapping retry", async () => {
    stripe.customers.list.mockReset().mockResolvedValueOnce({
      data: [],
      has_more: false,
    } as never);
    stripe.customers.create.mockRejectedValueOnce(
      new Error("ambiguous response"),
    );
    let pageNumber = 0;
    stripe.customers.list.mockImplementation(async () => {
      pageNumber++;
      return {
        data: Array.from({ length: 100 }, (_, index) => ({
          id: `cus_${pageNumber}_${index}`,
          metadata: {},
        })),
        has_more: true,
      } as never;
    });
    await expect(ensureHostedCustomer("test-salon")).rejects.toThrow(
      /safe recovery limit/,
    );
    expect(stripe.customers.list).toHaveBeenCalledTimes(21);
    expect(stripe.customers.list).toHaveBeenLastCalledWith(
      { limit: 100, starting_after: "cus_19_99" },
      { timeout: 5_000, maxNetworkRetries: 0 },
    );
    expect(state.updates).toHaveLength(0);
  });

  it("send_invoice sets days_until_due 14", async () => {
    await ensureHostedSubscription("test-salon", {
      trialDays: 14,
      collection: "send_invoice",
    });
    const [params] = stripe.subscriptions.create.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(params).toMatchObject({
      collection_method: "send_invoice",
      days_until_due: 14,
    });
  });

  it.each([
    ["unexpired tenant-bound legacy card", "charge_automatically", "cus_1", 12, new Date().getUTCFullYear() + 1],
    ["expired tenant-bound legacy card", "send_invoice", "cus_1", 1, new Date().getUTCFullYear() - 1],
    ["legacy card bound to another customer", "send_invoice", "cus_other", 12, new Date().getUTCFullYear() + 1],
  ] as const)("classifies %s for a switch", async (_name, collection, customerId, expMonth, expYear) => {
    state.tenant = tenant({ platformStripeCustomerId: "cus_1", billingSwitchedAt: null });
    state.customer = {
      ...state.customer,
      default_source: "src_legacy",
    };
    stripe.customers.retrieveSource.mockResolvedValueOnce({
      id: "src_legacy",
      object: "card",
      customer: customerId,
      exp_month: expMonth,
      exp_year: expYear,
    } as never);

    await ensureHostedSubscription("test-salon", {
      trialDays: 0,
      billingSwitch: true,
      ownerEmail: "owner@example.com",
    });

    const [params] = stripe.subscriptions.create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params.collection_method).toBe(collection);
    if (collection === "send_invoice") expect(params.days_until_due).toBe(14);
    expect(stripe.customers.update).toHaveBeenCalledWith(
      "cus_1",
      { email: "owner@example.com" },
      { timeout: 30_000, maxNetworkRetries: 0 },
    );
  });

  it("recovers a subscription with truncated item inventory before reconciling shared lines", async () => {
    state.tenant = tenant({
      platformStripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      smsLineStatus: "shared",
      billingSwitchedAt: null,
    });
    const fullItems = [
      { id: "si_base", quantity: 1, price: { id: "price_base", lookup_key: "hosted_base_monthly" } },
      { id: "si_extra", quantity: 0, price: { id: "price_extra", lookup_key: "hosted_extra_staff_monthly" } },
      { id: "si_line", quantity: 1, price: { id: "price_line", lookup_key: "hosted_text_line_monthly" } },
      { id: "si_meter", price: { id: "price_texts", lookup_key: "hosted_texts_metered" } },
    ];
    state.subscription = hostedSubscription(fullItems.slice(0, 2), {
      items: { data: fullItems.slice(0, 2), has_more: true },
    });
    stripe.subscriptionItems.list.mockResolvedValueOnce({
      data: fullItems,
      has_more: false,
    } as never);

    await ensureHostedSubscription("test-salon", {
      trialDays: 0,
      billingSwitch: true,
      ownerEmail: "owner@example.com",
    });

    expect(stripe.subscriptionItems.list).toHaveBeenCalledWith(
      { subscription: "sub_1", limit: 100, expand: ["data.price"] },
      { timeout: 5_000, maxNetworkRetries: 0 },
    );
    expect(stripe.subscriptionItems.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("updates a paused trial subscription in place, ends its trial, and resumes without shifting the anchor", async () => {
    state.tenant = tenant({
      platformStripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      billingSwitchedAt: null,
    });
    state.subscription = hostedSubscription([], { status: "paused" });
    await ensureHostedSubscription("test-salon", {
      trialDays: 0,
      billingSwitch: true,
      ownerEmail: "owner@example.com",
      collection: "send_invoice",
    });
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).toHaveBeenCalledWith(
      "sub_1",
      expect.objectContaining({
        collection_method: "send_invoice",
        days_until_due: 14,
        proration_behavior: "none",
      }),
      { timeout: 30_000, maxNetworkRetries: 0 },
    );
    expect(stripe.subscriptions.resume).toHaveBeenCalledWith(
      "sub_1",
      { billing_cycle_anchor: "unchanged", proration_behavior: "none" },
      { timeout: 30_000, maxNetworkRetries: 0 },
    );
  });

  it("fails closed for a canceled hosted subscription instead of creating a replacement", async () => {
    state.tenant = tenant({
      platformStripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      billingSwitchedAt: null,
    });
    state.subscription = hostedSubscription([], { status: "canceled" });
    await expect(ensureHostedSubscription("test-salon", {
      trialDays: 0,
      billingSwitch: true,
      ownerEmail: "owner@example.com",
    })).rejects.toThrow(/Terminal hosted subscription/);
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("makes no Stripe call in single mode", async () => {
    state.single = true;
    expect(
      await ensureHostedSubscription("test-salon", { trialDays: 14 }),
    ).toEqual({ skipped: "single_mode" });
    expect(writeCalls() + stripe.prices.list.mock.calls.length).toBe(0);
  });

  it("makes no Stripe call for a comped business", async () => {
    state.tenant = tenant({ comped: 1 });
    expect(
      await ensureHostedSubscription("test-salon", { trialDays: 14 }),
    ).toEqual({ skipped: "comped" });
    expect(writeCalls() + stripe.prices.list.mock.calls.length).toBe(0);
  });

  it("does not create a second subscription", async () => {
    state.tenant = tenant({ stripeSubscriptionId: "sub_old" });
    expect(
      await ensureHostedSubscription("test-salon", { trialDays: 14 }),
    ).toEqual({ skipped: "exists" });
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  });

  it("skips when there is no tenant", async () => {
    state.tenant = null;
    expect(await ensureHostedSubscription("nope", { trialDays: 14 })).toEqual({
      skipped: "no_tenant",
    });
    expect(writeCalls()).toBe(0);
  });
});

describe("syncHostedSubscription", () => {
  const item = (id: string, lookup_key: string, quantity?: number) => ({
    id,
    quantity,
    price: { lookup_key },
  });

  it("updates extra staff quantity with no proration", async () => {
    state.tenant = tenant({
      billableStaff: 3,
      platformStripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    state.subscription = hostedSubscription([
      item("si_base", "hosted_base_monthly", 1),
      item("si_extra", "hosted_extra_staff_monthly", 0),
    ]);
    const result = await syncHostedSubscription("test-salon");
    expect(result).toEqual({ created: 0, updated: 1, removed: 0 });
    expect(stripe.subscriptionItems.update).toHaveBeenCalledTimes(1);
    expect(stripe.subscriptionItems.update).toHaveBeenCalledWith(
      "si_extra",
      { quantity: 2, proration_behavior: "none" },
      { timeout: 30_000, maxNetworkRetries: 0 },
    );
    expect(stripe.subscriptionItems.create).not.toHaveBeenCalled();
    expect(stripe.subscriptionItems.del).not.toHaveBeenCalled();
  });

  it("creates missing and removes undesired items", async () => {
    state.tenant = tenant({ platformStripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" });
    state.subscription = hostedSubscription([
      item("si_base", "hosted_base_monthly", 1),
      item("si_line", "hosted_text_line_monthly", 1),
    ]);
    const result = await syncHostedSubscription("test-salon");
    expect(result).toEqual({ created: 1, updated: 0, removed: 1 });
    expect(stripe.subscriptionItems.create).toHaveBeenCalledWith(
      {
        subscription: "sub_1",
        price: "price_extra",
        quantity: 0,
        proration_behavior: "none",
      },
      { idempotencyKey: "hosted-item:sub_1:hosted_extra_staff_monthly", timeout: 30_000, maxNetworkRetries: 0 },
    );
    expect(stripe.subscriptionItems.del).toHaveBeenCalledWith(
      "si_line",
      { proration_behavior: "none" },
      { timeout: 30_000, maxNetworkRetries: 0 },
    );
  });

  it("adds active-line items without proration and removes them when the line is off", async () => {
    state.tenant = tenant({
      smsLineStatus: "active",
      platformStripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    state.subscription = hostedSubscription([
      item("si_base", "hosted_base_monthly", 1),
      item("si_extra", "hosted_extra_staff_monthly", 0),
    ]);
    expect(await syncHostedSubscription("test-salon")).toEqual({
      created: 2,
      updated: 0,
      removed: 0,
    });
    expect(stripe.subscriptionItems.create).toHaveBeenCalledWith(
      {
        subscription: "sub_1",
        price: "price_line",
        quantity: 1,
        proration_behavior: "none",
      },
      { idempotencyKey: "hosted-item:sub_1:hosted_text_line_monthly", timeout: 30_000, maxNetworkRetries: 0 },
    );
    expect(stripe.subscriptionItems.create).toHaveBeenCalledWith(
      {
        subscription: "sub_1",
        price: "price_texts",
        proration_behavior: "none",
      },
      { idempotencyKey: "hosted-item:sub_1:hosted_texts_metered", timeout: 30_000, maxNetworkRetries: 0 },
    );

    vi.clearAllMocks();
    resetHostedPriceCacheForTests();
    state.tenant = tenant({
      smsLineStatus: "pending",
      platformStripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    state.subscription = hostedSubscription([
      item("si_base", "hosted_base_monthly", 1),
      item("si_extra", "hosted_extra_staff_monthly", 0),
      item("si_line", "hosted_text_line_monthly", 1),
      item("si_texts", "hosted_texts_metered"),
    ]);
    expect(await syncHostedSubscription("test-salon")).toEqual({
      created: 0,
      updated: 0,
      removed: 2,
    });
    expect(stripe.subscriptionItems.del).toHaveBeenCalledTimes(2);
  });

  it("makes no write when nothing changed", async () => {
    state.tenant = tenant({ platformStripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" });
    state.subscription = hostedSubscription([
      item("si_base", "hosted_base_monthly", 1),
      item("si_extra", "hosted_extra_staff_monthly", 0),
    ]);
    expect(await syncHostedSubscription("test-salon")).toEqual({
      created: 0,
      updated: 0,
      removed: 0,
    });
    expect(writeCalls()).toBe(0);
  });

  it("skips single mode, comped, and no subscription", async () => {
    state.tenant = tenant();
    expect(await syncHostedSubscription("test-salon")).toEqual({
      skipped: "no_subscription",
    });
    state.tenant = tenant({ comped: 1, stripeSubscriptionId: "sub_1" });
    expect(await syncHostedSubscription("test-salon")).toEqual({
      skipped: "comped",
    });
    state.single = true;
    expect(await syncHostedSubscription("test-salon")).toEqual({
      skipped: "single_mode",
    });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(writeCalls()).toBe(0);
  });
});

describe("hosted catalog", () => {
  it("amounts match hosted-pricing", () => {
    expect(HOSTED_PRICES.hosted_base_monthly.unitAmountCents).toBe(
      pricing.BASE_CENTS,
    );
    expect(HOSTED_PRICES.hosted_extra_staff_monthly.unitAmountCents).toBe(
      pricing.EXTRA_STAFF_CENTS,
    );
    expect(HOSTED_PRICES.hosted_text_line_monthly.unitAmountCents).toBe(
      pricing.TEXT_LINE_CENTS,
    );
    expect(HOSTED_PRICES.hosted_texts_metered.unitAmountCents).toBe(
      pricing.PER_TEXT_CENTS,
    );
    expect(HOSTED_PRICES.hosted_text_line_setup.unitAmountCents).toBe(
      pricing.TEXT_SETUP_CENTS,
    );
  });

  it("pins the literal amounts and kinds", () => {
    expect(
      Object.fromEntries(
        Object.entries(HOSTED_PRICES).map(([k, v]) => [
          k,
          [v.unitAmountCents, v.kind],
        ]),
      ),
    ).toEqual({
      hosted_base_monthly: [1200, "licensed"],
      hosted_extra_staff_monthly: [600, "licensed"],
      hosted_text_line_monthly: [400, "licensed"],
      hosted_texts_metered: [5, "metered"],
      hosted_text_line_setup: [1900, "one_time"],
    });
  });
});

describe("diffItems", () => {
  const cur = (entries: Array<[string, string, number | null]>) =>
    new Map(entries.map(([key, id, quantity]) => [key, { id, quantity }]));

  it("changes only the extra staff quantity when staff changes", () => {
    const plan = diffItems(
      cur([
        ["hosted_base_monthly", "si_base", 1],
        ["hosted_extra_staff_monthly", "si_extra", 0],
      ]),
      desiredItems({ billableStaff: 2 }),
    );
    expect(plan.create).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.update).toEqual([
      {
        id: "si_extra",
        lookupKey: "hosted_extra_staff_monthly",
        from: 0,
        quantity: 1,
      },
    ]);
  });

  it("creates missing items and removes ones no longer wanted", () => {
    const plan = diffItems(
      cur([
        ["hosted_base_monthly", "si_base", 1],
        ["hosted_extra_staff_monthly", "si_extra", 0],
        ["hosted_text_line_monthly", "si_line", 1],
        ["hosted_texts_metered", "si_texts", null],
      ]),
      desiredItems({ billableStaff: 1 }),
    );
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove.map((r) => r.lookupKey).sort()).toEqual([
      "hosted_text_line_monthly",
      "hosted_texts_metered",
    ]);

    const add = diffItems(
      cur([["hosted_base_monthly", "si_base", 1]]),
      desiredItems({ billableStaff: 1, smsLineStatus: "active" }),
    );
    expect(add.create.map((c) => c.lookupKey)).toEqual([
      "hosted_extra_staff_monthly",
      "hosted_text_line_monthly",
      "hosted_texts_metered",
    ]);
  });

  it("is empty when nothing differs", () => {
    const plan = diffItems(
      cur([
        ["hosted_base_monthly", "si_base", 1],
        ["hosted_extra_staff_monthly", "si_extra", 2],
      ]),
      desiredItems({ billableStaff: 3 }),
    );
    expect(plan).toEqual({ create: [], update: [], remove: [] });
  });
});
