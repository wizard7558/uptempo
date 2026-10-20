import type Stripe from "stripe";

/** Stripe API still returns these fields; generated TS types omit them in newer SDK versions. */
export function getInvoiceSubscriptionId(
  invoice: Stripe.Invoice,
): string | undefined {
  const inv = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  const sub = inv.subscription;
  if (!sub) return undefined;
  return typeof sub === "string" ? sub : sub.id;
}
