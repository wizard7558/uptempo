// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  hasModule: vi.fn(),
  findGiftCardByCode: vi.fn(),
  withTenantDb: vi.fn(),
  getTenantBySlug: vi.fn(),
  getConnectChargeParams: vi.fn(),
  create: vi.fn(),
  retrieve: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("@/lib/terms/server", () => ({
  getT: async (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeRateLimit: h.consumeRateLimit }));
vi.mock("@/lib/tenant/modules", () => ({ hasModule: h.hasModule }));
vi.mock("@/lib/db/tenant", () => ({
  withTenantDb: (...args: unknown[]) => h.withTenantDb(...args),
}));
vi.mock("@/lib/gift-cards/service", () => ({
  findGiftCardByCode: (...args: unknown[]) => h.findGiftCardByCode(...args),
}));
vi.mock("@/lib/tenant/registry", () => ({
  getTenantBySlug: (...args: unknown[]) => h.getTenantBySlug(...args),
}));
vi.mock("@/lib/stripe/connect-charge-params", () => ({
  getConnectChargeParams: (...args: unknown[]) => h.getConnectChargeParams(...args),
}));
vi.mock("@/lib/stripe/server", () => ({
  getStripe: () => ({
    checkout: { sessions: { create: h.create, retrieve: h.retrieve } },
  }),
}));

import { checkGiftCardBalance, startGiftCardPurchase } from "./gift-cards-public";
import { createGiftCardCheckoutSession } from "@/lib/gift-cards/purchase";

const buyer = {
  purchaserName: "Sam",
  purchaserEmail: "sam@example.com",
  recipientName: "Jo",
  recipientEmail: "jo@example.com",
};

describe("public gift card actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.hasModule.mockResolvedValue(true);
    h.consumeRateLimit.mockResolvedValue({ allowed: true });
    h.findGiftCardByCode.mockResolvedValue(null);
    h.withTenantDb.mockImplementation(async (_slug: string, cb: (db: unknown, tables: unknown) => unknown) =>
      cb({}, {}),
    );
  });

  it("limits balance checks with gc_balance:<ip>", async () => {
    await checkGiftCardBalance("business", "ABCDEFGHJKMNPQRS");
    expect(h.consumeRateLimit).toHaveBeenCalledWith({
      tenantSlug: "business",
      scope: "ip",
      key: "gc_balance:203.0.113.9",
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
  });

  it("returns the same error for an invalid code and an unknown code", async () => {
    const invalid = await checkGiftCardBalance("business", "not-a-code");
    const unknown = await checkGiftCardBalance("business", "ABCDEFGHJKMNPQRS");
    expect(invalid).toEqual(unknown);
    expect(invalid).toEqual({ success: false, error: "errors.giftCards.notFound" });
  });

  it("rejects an amount under $10", async () => {
    const result = await startGiftCardPurchase("business", { ...buyer, amountCents: 999 });
    expect(result).toEqual({ success: false, error: "errors.giftCards.amountRange" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("sends the charge to the connected account with the gift card purpose", async () => {
    h.getTenantBySlug.mockResolvedValue({
      name: "Business",
      stripeConnectAccountId: "acct_123",
    });
    h.getConnectChargeParams.mockResolvedValue({
      connectAccountId: "acct_123",
      platformFeeCents: 40,
    });
    h.create.mockResolvedValue({ url: "https://checkout.stripe.test/cs" });

    const started = await createGiftCardCheckoutSession("business", {
      ...buyer,
      amountCents: 5000,
      message: "Enjoy",
    });
    expect(started).toEqual({ ok: true, url: "https://checkout.stripe.test/cs" });
    const params = h.create.mock.calls[0][0];
    expect(params.payment_intent_data.transfer_data).toEqual({ destination: "acct_123" });
    expect(params.payment_intent_data.application_fee_amount).toBe(40);
    expect(params.payment_intent_data.metadata.purpose).toBe("gift_card_purchase");
    expect(params.metadata.purpose).toBe("gift_card_purchase");
    expect(params.metadata.tenantSlug).toBe("business");
    expect(params.customer_email).toBe("sam@example.com");
  });
});
