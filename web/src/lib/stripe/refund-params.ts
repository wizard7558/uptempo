import { getStripe } from "@/lib/stripe/server";

type RefundParams =
  | { reverse_transfer: true; refund_application_fee?: true }
  | Record<string, never>;

type RefundOptions = {
  /**
   * Undo of a charge whose sale never completed: also returns the processing fee.
   * Leave unset for a refund of a completed sale, where the platform keeps the fee (D14).
   */
  undo?: boolean;
};

/**
 * Refunds of destination charges pull the business's share back (D14). Charges with no Connect
 * account refund exactly as before.
 */
export function destinationRefundParams(
  connectAccountId: string | null | undefined,
  options: RefundOptions = {},
): RefundParams {
  if (!connectAccountId) return {};
  return options.undo
    ? { reverse_transfer: true, refund_application_fee: true }
    : { reverse_transfer: true };
}

/** For callers with no charge row: a PaymentIntent is a destination charge when it has transfer_data. */
export async function destinationRefundParamsForIntent(
  paymentIntentId: string,
  options: RefundOptions = {},
): Promise<RefundParams> {
  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
  return destinationRefundParams(intent.transfer_data?.destination as string | undefined, options);
}
