import type Stripe from "stripe";

const MONTH = "month" as const;

/**
 * Reuse an active monthly recurring Stripe Price on `productId` whose
 * `unit_amount` matches `unitAmountCents`, or create one. Returns the price id.
 *
 * This is how we support custom Beauty Bank contribution amounts without
 * creating a new Product per amount: one Product per plan, many Prices.
 * `unit_amount` is not a server-side list filter, so we match in memory.
 */
export async function getOrCreateMonthlyPrice(
  stripe: Stripe,
  args: {
    productId: string;
    unitAmountCents: number;
    slug: string;
    planId: string;
  },
): Promise<string> {
  const { productId, unitAmountCents, slug, planId } = args;

  const existing = await stripe.prices.list({
    product: productId,
    active: true,
    type: "recurring",
    currency: "usd",
    recurring: { interval: MONTH },
    limit: 100,
  });
  const match = existing.data.find(
    (price) =>
      price.unit_amount === unitAmountCents &&
      price.recurring?.interval === MONTH,
  );
  if (match) return match.id;

  const created = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmountCents,
    currency: "usd",
    recurring: { interval: MONTH },
    metadata: {
      tenantSlug: slug,
      planId,
      purpose: "beauty_bank_plan_custom",
    },
  });
  return created.id;
}
