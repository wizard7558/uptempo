/**
 * The money side of a multi-session project. Pure: callers load the charges
 * of every appointment in the project and pass them in.
 */
export type ProjectCharge = {
  reason: string;
  status: string;
  amountCents: number;
  tipCents: number | null;
  depositAppliedCents: number;
};

export type ProjectBalance = {
  /** Service payments, tips excluded. */
  billedCents: number;
  /** Deposits collected on the project's appointments. */
  depositsCents: number;
  /** Deposit already used up by service payments. */
  appliedCents: number;
  paidCents: number;
  /** Quoted total minus paid; null when the project has no quoted total. */
  balanceCents: number | null;
  /** Deposit collected and not yet applied to a service payment. */
  depositCreditCents: number;
};

/** Only completed charges count: a failed or pending charge has not moved money. */
export function computeProjectBalance(
  quotedTotalCents: number | null,
  charges: ProjectCharge[],
): ProjectBalance {
  let billedCents = 0;
  let depositsCents = 0;
  let appliedCents = 0;
  for (const c of charges) {
    if (c.status !== "completed") continue;
    if (c.reason === "service_payment") {
      billedCents += c.amountCents - (c.tipCents ?? 0);
      appliedCents += c.depositAppliedCents;
    } else if (c.reason === "deposit") {
      depositsCents += c.amountCents;
    }
  }
  const paidCents = billedCents - appliedCents + depositsCents;
  return {
    billedCents,
    depositsCents,
    appliedCents,
    paidCents,
    balanceCents: quotedTotalCents == null ? null : quotedTotalCents - paidCents,
    depositCreditCents: depositsCents - appliedCents,
  };
}
