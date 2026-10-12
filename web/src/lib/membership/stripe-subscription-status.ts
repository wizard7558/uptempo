import type Stripe from "stripe";

type MembershipRecordStatus = "active" | "past_due" | "cancelled" | "paused";

/** Exported for tests to keep Stripe->membership status handling stable. */
export function mapMembershipSubscriptionStatus(
  status: Stripe.Subscription.Status,
): MembershipRecordStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "cancelled";
    case "paused":
      return "paused";
    default:
      return "past_due";
  }
}

/** Exported for tests; only these statuses count as immediate self-serve success. */
export function isStripeSubscriptionImmediatelyUsable(
  status: Stripe.Subscription.Status,
): boolean {
  return status === "active" || status === "trialing";
}
