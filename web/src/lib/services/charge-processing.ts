import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { isSingleMode } from "@/lib/config/mode";
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

/** Default platform fee by plan tier. */
const PLAN_FEE_PERCENT: Record<string, number> = {
  starter: 0.5,
  pro: 1,
  business: 2,
};

/**
 * Calculate the platform fee for a charge amount.
 *
 * Priority:
 * 1. Tenant's explicit platformFeePercent (null means use default, 0 means exempt)
 * 2. Plan-based default (starter=5%, pro=3%, business=2%)
 * 3. PLATFORM_FEE_PERCENT env var fallback
 *
 * Returns fee in cents, capped at amountCents - 1 to ensure Stripe accepts it.
 */
export function calculatePlatformFee(
  amountCents: number,
  tenant?: { plan?: string; platformFeePercent?: number | null },
): number {
  if (isSingleMode()) return 0;
  if (amountCents <= 0) return 0;

  let feePercent: number;

  if (tenant?.platformFeePercent !== undefined && tenant.platformFeePercent !== null) {
    // Explicit override (0 = exempt)
    feePercent = tenant.platformFeePercent;
  } else if (tenant?.plan && tenant.plan in PLAN_FEE_PERCENT) {
    // Plan-based default
    feePercent = PLAN_FEE_PERCENT[tenant.plan];
  } else {
    // Env var fallback
    feePercent = parseInt(process.env.PLATFORM_FEE_PERCENT ?? "0", 10);
  }

  if (feePercent <= 0) return 0;
  const feeCents = Math.round(amountCents * (feePercent / 100));
  return Math.min(feeCents, amountCents - 1);
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
