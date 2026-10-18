import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";

export interface ChargeParams {
  amountCents: number;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  metadata: Record<string, string>;
  connectAccountId?: string;
  platformFeeCents?: number;
  /** Stripe idempotency key: the same key never creates a second PaymentIntent. */
  idempotencyKey?: string;
}

export interface ChargeResult {
  stripePaymentIntentId: string | null;
  status: "completed" | "failed" | "pending";
  failureReason: string | null;
}

/**
 * Process an off-session Stripe charge.
 * Creates and confirms a PaymentIntent with the customer's saved payment method.
 * Optionally routes as a destination charge to a Connect account with platform fee.
 * Returns the result for recording in the charges table.
 */
export async function processOffSessionCharge(
  params: ChargeParams,
): Promise<ChargeResult> {
  // Test-only seam: lets e2e assert "deposit paid" without Stripe. Never active
  // in production, whatever the env says.
  if (
    process.env.PAYMENTS_FAKE === "1" &&
    process.env.VERCEL_ENV !== "production" &&
    process.env.NODE_ENV !== "production"
  ) {
    return {
      stripePaymentIntentId: `pi_fake_${randomUUID()}`,
      status: "completed",
      failureReason: null,
    };
  }
  try {
    const intentParams: Stripe.PaymentIntentCreateParams = {
      amount: params.amountCents,
      currency: "usd",
      customer: params.stripeCustomerId,
      payment_method: params.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: params.metadata,
    };

    // Add destination charge routing if Connect account is available
    if (params.connectAccountId) {
      intentParams.transfer_data = { destination: params.connectAccountId };
      if (params.platformFeeCents && params.platformFeeCents > 0) {
        intentParams.application_fee_amount = params.platformFeeCents;
      }
    }

    const paymentIntent = params.idempotencyKey
      ? await getStripe().paymentIntents.create(intentParams, {
          idempotencyKey: params.idempotencyKey,
        })
      : await getStripe().paymentIntents.create(intentParams);
    const isCompleted = paymentIntent.status === "succeeded";
    const isPending = paymentIntent.status === "processing";

    return {
      stripePaymentIntentId: paymentIntent.id,
      status: isCompleted ? "completed" : isPending ? "pending" : "failed",
      failureReason:
        !isCompleted && !isPending
          ? `Payment status: ${paymentIntent.status}`
          : null,
    };
  } catch (stripeError: unknown) {
    return {
      stripePaymentIntentId: null,
      status: "failed",
      failureReason:
        stripeError &&
        typeof stripeError === "object" &&
        "message" in stripeError
          ? (stripeError as { message: string }).message
          : "Payment failed",
    };
  }
}
