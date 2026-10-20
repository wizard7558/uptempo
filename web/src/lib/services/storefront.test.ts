import { describe, expect, it, vi } from "vitest";
import { priceOrder, type PricedCartItem } from "./storefront";

// priceOrder is pure; mock the modules the file imports at top level so the
// import doesn't drag in DB/Stripe env requirements.
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: vi.fn() }));
vi.mock("@/lib/tenant/registry", () => ({ getTenantBySlug: vi.fn() }));
vi.mock("@/lib/stripe/server", () => ({ getStripe: vi.fn() }));
vi.mock("@/lib/utils", () => ({ getBaseUrl: () => "https://test.local" }));

function item(overrides: Partial<PricedCartItem> = {}): PricedCartItem {
  return {
    productId: "p1",
    name: "K18 AirWash",
    quantity: 1,
    unitCents: 3200,
    ...overrides,
  };
}

describe("priceOrder", () => {
  it("computes subtotal from unit price × quantity across items", () => {
    const pricing = priceOrder({
      items: [
        item({ productId: "a", unitCents: 3200, quantity: 2 }), // 6400
        item({ productId: "b", unitCents: 2600, quantity: 1 }), // 2600
      ],
      taxBps: 0,
      shippingCents: 0,
      feeOnSubtotal: () => 0,
    });
    expect(pricing.subtotalCents).toBe(9_000);
    expect(pricing.taxCents).toBe(0);
    expect(pricing.totalCents).toBe(9_000);
    expect(pricing.platformFeeCents).toBe(0);
  });

  it("applies flat tax in basis points on the subtotal, rounded", () => {
    // $90.00 at 7.25% = $6.525 → 653 cents.
    const pricing = priceOrder({
      items: [item({ unitCents: 9_000, quantity: 1 })],
      taxBps: 725,
      shippingCents: 0,
      feeOnSubtotal: () => 0,
    });
    expect(pricing.taxCents).toBe(653);
    expect(pricing.totalCents).toBe(9_653);
  });

  it("adds flat shipping to the total but not the tax base", () => {
    const pricing = priceOrder({
      items: [item({ unitCents: 10_000 })],
      taxBps: 1000, // 10%
      shippingCents: 1_000,
      feeOnSubtotal: () => 0,
    });
    expect(pricing.taxCents).toBe(1_000); // 10% of subtotal only
    expect(pricing.shippingCents).toBe(1_000);
    expect(pricing.totalCents).toBe(12_000);
  });

  it("takes the platform fee on the subtotal only (not tax/shipping)", () => {
    const pricing = priceOrder({
      items: [item({ unitCents: 10_000 })],
      taxBps: 725,
      shippingCents: 1_000,
      feeOnSubtotal: (subtotal) => Math.round((subtotal * 2) / 100),
    });
    expect(pricing.platformFeeCents).toBe(200); // 2% of $100
  });

  it("drops zero-quantity items and throws on an empty cart", () => {
    expect(() =>
      priceOrder({
        items: [item({ quantity: 0 })],
        taxBps: 0,
        shippingCents: 0,
        feeOnSubtotal: () => 0,
      }),
    ).toThrow(/empty/i);
  });

  it("treats negative/invalid tax and fee inputs as zero", () => {
    const pricing = priceOrder({
      items: [item()],
      taxBps: -50,
      shippingCents: -100,
      feeOnSubtotal: () => Number.NaN,
    });
    expect(pricing.taxCents).toBe(0);
    expect(pricing.shippingCents).toBe(0);
    expect(pricing.platformFeeCents).toBe(0);
  });
});
