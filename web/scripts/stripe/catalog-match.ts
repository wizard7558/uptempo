import type Stripe from "stripe";
import type { HostedPriceSpec } from "../../src/lib/billing/hosted-catalog";

/** True when an existing Stripe price already matches the catalog spec. */
export function priceMatches(
  spec: HostedPriceSpec,
  price: Stripe.Price,
  meterId: string,
): boolean {
  if (price.unit_amount !== spec.unitAmountCents) return false;
  if (price.currency !== "usd") return false;
  const productId =
    typeof price.product === "string" ? price.product : price.product.id;
  if (productId !== spec.productId) return false;
  if (spec.kind === "one_time") return price.recurring == null;
  const recurring = price.recurring;
  if (!recurring || recurring.interval !== "month") return false;
  if (recurring.interval_count !== 1) return false;
  if (spec.kind === "licensed") return recurring.usage_type === "licensed";
  return recurring.usage_type === "metered" && recurring.meter === meterId;
}

export const PORTAL_HEADLINE = "Uptempo billing";

/** Portal features Uptempo wants (phase 6 D5): cards, invoices, cancel at period end, no plan switching. */
export const DESIRED_PORTAL_FEATURES = {
  payment_method_update: { enabled: true },
  invoice_history: { enabled: true },
  subscription_cancel: { enabled: true, mode: "at_period_end" },
  subscription_update: { enabled: false },
  customer_update: { enabled: true, allowed_updates: ["email", "address"] },
} satisfies Stripe.BillingPortal.ConfigurationCreateParams.Features;

/** True when a portal configuration already has the desired features. */
export function portalMatches(
  config: Stripe.BillingPortal.Configuration,
): boolean {
  const f = config.features;
  const allowed = [...f.customer_update.allowed_updates].sort().join(",");
  return (
    f.payment_method_update.enabled === true &&
    f.invoice_history.enabled === true &&
    f.subscription_cancel.enabled === true &&
    f.subscription_cancel.mode === "at_period_end" &&
    f.subscription_update.enabled === false &&
    f.customer_update.enabled === true &&
    allowed === "address,email"
  );
}
