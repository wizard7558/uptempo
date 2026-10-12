import Stripe from "stripe";
import { getStripe } from "./server";

export function verifyWebhookSignature(
  body: string,
  signature: string,
): Stripe.Event {
  return getStripe().webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
}
