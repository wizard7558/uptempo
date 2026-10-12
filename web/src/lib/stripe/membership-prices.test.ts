import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { getOrCreateMonthlyPrice } from "./membership-prices";

function fakeStripe(opts: {
  listData: Array<Partial<Stripe.Price>>;
  createdId?: string;
}) {
  const create = vi.fn(async () => ({ id: opts.createdId ?? "price_new" }));
  const list = vi.fn(async () => ({ data: opts.listData }));
  const stripe = { prices: { list, create } } as unknown as Stripe;
  return { stripe, create, list };
}

const baseArgs = {
  productId: "prod_1",
  slug: "salon-x",
  planId: "plan_1",
};

describe("getOrCreateMonthlyPrice", () => {
  it("reuses an existing active monthly price with the same amount", async () => {
    const { stripe, create } = fakeStripe({
      listData: [
        { id: "price_keep", unit_amount: 25000, recurring: { interval: "month" } as Stripe.Price.Recurring },
      ],
    });
    const id = await getOrCreateMonthlyPrice(stripe, {
      ...baseArgs,
      unitAmountCents: 25000,
    });
    expect(id).toBe("price_keep");
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a new price when no amount matches", async () => {
    const { stripe, create } = fakeStripe({
      listData: [
        { id: "price_other", unit_amount: 10000, recurring: { interval: "month" } as Stripe.Price.Recurring },
      ],
      createdId: "price_made",
    });
    const id = await getOrCreateMonthlyPrice(stripe, {
      ...baseArgs,
      unitAmountCents: 25000,
    });
    expect(id).toBe("price_made");
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        product: "prod_1",
        unit_amount: 25000,
        currency: "usd",
        recurring: { interval: "month" },
      }),
    );
  });

  it("does not reuse a non-monthly price even if the amount matches", async () => {
    const { stripe, create } = fakeStripe({
      listData: [
        { id: "price_year", unit_amount: 25000, recurring: { interval: "year" } as Stripe.Price.Recurring },
      ],
    });
    const id = await getOrCreateMonthlyPrice(stripe, {
      ...baseArgs,
      unitAmountCents: 25000,
    });
    expect(id).toBe("price_new");
    expect(create).toHaveBeenCalledOnce();
  });
});
