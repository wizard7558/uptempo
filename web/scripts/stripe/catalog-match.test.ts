import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { HOSTED_PRICES } from "../../src/lib/billing/hosted-catalog";
import {
  DESIRED_PORTAL_FEATURES,
  portalMatches,
  priceMatches,
} from "./catalog-match";

const METER = "mtr_1";

function specFor(kind: "licensed" | "metered" | "one_time") {
  const spec = Object.values(HOSTED_PRICES).find((s) => s.kind === kind);
  if (!spec) throw new Error(`no ${kind} spec`);
  return spec;
}

function priceFor(kind: "licensed" | "metered" | "one_time", over = {}) {
  const spec = specFor(kind);
  return {
    unit_amount: spec.unitAmountCents,
    currency: "usd",
    product: spec.productId,
    recurring:
      kind === "one_time"
        ? null
        : {
            interval: "month",
            interval_count: 1,
            usage_type: kind,
            meter: kind === "metered" ? METER : null,
          },
    ...over,
  } as unknown as Stripe.Price;
}

describe("priceMatches", () => {
  it("accepts matching prices of every kind", () => {
    for (const kind of ["licensed", "metered", "one_time"] as const) {
      expect(priceMatches(specFor(kind), priceFor(kind), METER)).toBe(true);
    }
  });

  it("accepts an expanded product object", () => {
    const spec = specFor("licensed");
    const p = priceFor("licensed", { product: { id: spec.productId } });
    expect(priceMatches(spec, p, METER)).toBe(true);
  });

  it("rejects a different amount, currency, or product", () => {
    const spec = specFor("licensed");
    expect(priceMatches(spec, priceFor("licensed", { unit_amount: 1 }), METER)).toBe(false);
    expect(priceMatches(spec, priceFor("licensed", { currency: "eur" }), METER)).toBe(false);
    expect(priceMatches(spec, priceFor("licensed", { product: "other" }), METER)).toBe(false);
  });

  it("rejects a metered price on another meter or a licensed usage type", () => {
    const spec = specFor("metered");
    expect(priceMatches(spec, priceFor("metered"), "mtr_other")).toBe(false);
    const licensed = priceFor("metered", {
      recurring: { interval: "month", interval_count: 1, usage_type: "licensed", meter: null },
    });
    expect(priceMatches(spec, licensed, METER)).toBe(false);
  });

  it("rejects recurring for one_time and one_time for recurring", () => {
    expect(priceMatches(specFor("one_time"), priceFor("licensed", { unit_amount: specFor("one_time").unitAmountCents, product: specFor("one_time").productId }), METER)).toBe(false);
    expect(priceMatches(specFor("licensed"), priceFor("licensed", { recurring: null }), METER)).toBe(false);
  });

  it("rejects a yearly interval", () => {
    const p = priceFor("licensed", {
      recurring: { interval: "year", interval_count: 1, usage_type: "licensed", meter: null },
    });
    expect(priceMatches(specFor("licensed"), p, METER)).toBe(false);
  });
});

describe("portalMatches", () => {
  const good = () =>
    ({
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
        subscription_update: { enabled: false },
        customer_update: { enabled: true, allowed_updates: ["address", "email"] },
      },
    }) as unknown as Stripe.BillingPortal.Configuration;

  it("matches the desired features regardless of order", () => {
    expect(portalMatches(good())).toBe(true);
    expect(DESIRED_PORTAL_FEATURES.customer_update.allowed_updates).toEqual(["email", "address"]);
  });

  it("rejects plan switching, immediate cancel, or extra updates", () => {
    const a = good();
    a.features.subscription_update.enabled = true;
    expect(portalMatches(a)).toBe(false);
    const b = good();
    b.features.subscription_cancel.mode = "immediately";
    expect(portalMatches(b)).toBe(false);
    const c = good();
    c.features.customer_update.allowed_updates = ["email", "address", "name"];
    expect(portalMatches(c)).toBe(false);
  });
});
