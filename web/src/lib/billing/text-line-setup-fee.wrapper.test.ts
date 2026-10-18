// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const originalFake = process.env.PAYMENTS_FAKE;

beforeEach(() => {
  vi.clearAllMocks();
  h.writes.length = 0;
  process.env.PAYMENTS_FAKE = "0";
  h.getStripe.mockImplementation(() => {
    throw new Error("Stripe must stay lazy for exempt and already-paid rows");
  });
  h.customer.mockResolvedValue("cus_unused");
});

afterAll(() => {
  if (originalFake === undefined) delete process.env.PAYMENTS_FAKE;
  else process.env.PAYMENTS_FAKE = originalFake;
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
});
