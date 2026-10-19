// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tenant: null as Record<string, unknown> | null,
  getStripe: vi.fn(),
  customer: vi.fn(),
  writes: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/config/mode", () => ({ isSingleMode: () => false }));
vi.mock("@/lib/db/schema", () => ({
  tenants: new Proxy({}, { get: (_target, key) => String(key) }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => parts,
  eq: (column: unknown, value: unknown) => [column, value],
  sql: Object.assign(
    (parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values }),
    {
      raw: (value: string) => value,
    },
  ),
}));
vi.mock("@/lib/db", () => ({
  publicDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (h.tenant ? [structuredClone(h.tenant)] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            h.writes.push(values);
            return [{ slug: "test-salon" }];
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/stripe/server", () => ({ getStripe: () => h.getStripe() }));
vi.mock("@/lib/billing/subscriptions", () => ({
  ensureHostedCustomer: (...args: unknown[]) => h.customer(...args),
}));

import { ensureTextLineSetupFee } from "./text-line-setup-fee";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  h.writes.length = 0;
  vi.stubEnv("PAYMENTS_FAKE", "0");
  h.getStripe.mockImplementation(() => {
    throw new Error("Stripe must stay lazy for exempt and already-paid rows");
  });
  h.customer.mockResolvedValue("cus_unused");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ensureTextLineSetupFee Stripe laziness", () => {
  it("does not construct Stripe for a comped tenant", async () => {
    h.tenant = {
      slug: "test-salon",
      name: "Test Salon",
      comped: 1,
      smsLineStatus: "off",
      smsRegistration: {},
      platformStripeCustomerId: null,
    };
    await expect(ensureTextLineSetupFee("test-salon")).resolves.toEqual({
      ok: true,
      status: "waived",
    });
    expect(h.getStripe).not.toHaveBeenCalled();
    expect(h.customer).not.toHaveBeenCalled();
  });

  it("does not construct Stripe for a row with a durable paid marker", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENTS_FAKE", "1");
    h.tenant = {
      slug: "test-salon",
      name: "Test Salon",
      comped: 0,
      smsLineStatus: "off",
      smsRegistration: {
        setupFeeState: "added",
        setupFeeInvoiceItemId: "ii_already_paid",
      },
      platformStripeCustomerId: "cus_1",
    };
    await expect(ensureTextLineSetupFee("test-salon")).resolves.toEqual({
      ok: true,
      status: "already_added",
    });
    expect(h.getStripe).not.toHaveBeenCalled();
    expect(h.customer).not.toHaveBeenCalled();
  });

  it("keeps the Stripe setup-fee refusal in production when fake payments are requested", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PAYMENTS_FAKE", "1");
    h.tenant = {
      slug: "test-salon",
      name: "Test Salon",
      comped: 0,
      smsLineStatus: "off",
      smsRegistration: {},
      platformStripeCustomerId: "cus_1",
    };
    const stripe = {
      invoiceItems: {
        list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
        create: vi.fn().mockRejectedValue(new Error("Stripe refused setup fee")),
      },
    };
    h.getStripe.mockReturnValue(stripe);

    await expect(ensureTextLineSetupFee("test-salon")).resolves.toEqual({
      ok: false,
      error: "setup_fee_unavailable",
    });
    expect(h.getStripe).toHaveBeenCalledTimes(1);
    expect(stripe.invoiceItems.list).toHaveBeenCalledTimes(1);
    expect(stripe.invoiceItems.create).toHaveBeenCalledTimes(1);
    expect(stripe.invoiceItems.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", amount: 1900 }),
      expect.objectContaining({
        idempotencyKey: "text-line-setup-fee:test-salon",
        maxNetworkRetries: 0,
      }),
    );
    expect(h.writes.at(-1)).not.toMatchObject({
      smsRegistration: expect.objectContaining({
        setupFeeState: "added",
        setupFeeInvoiceItemId: expect.stringMatching(/^ii_fake_/),
      }),
    });
  });
});
