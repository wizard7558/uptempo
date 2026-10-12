import { loadStripe } from "@stripe/stripe-js";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

// Avoid crashing pages that import checkout/payment components when
// Stripe env vars are not configured in local/dev environments.
export const stripePromise = publishableKey
  ? loadStripe(publishableKey)
  : Promise.resolve(null);
