import { getStripe } from "@/lib/stripe/server";

/**
 * Register a domain with Stripe for Apple Pay and Google Pay.
 * For destination charges, register on the platform account (no Stripe-Account header).
 */
export async function registerDomainWithStripe(domain: string) {
  const stripe = getStripe();
  const pmd = await stripe.paymentMethodDomains.create({
    domain_name: domain,
  });
  return {
    id: pmd.id,
    applePayStatus: pmd.apple_pay.status,
    googlePayStatus: pmd.google_pay.status,
  };
}
