/**
 * Charge reasons that count as money taken in revenue totals.
 *
 * - service_payment: the visit's full revenue (a deposit is a prepayment
 *   already recognized here, so `deposit` is deliberately excluded).
 * - package_sale: a session pack sold. Visits paid with a pack credit record
 *   only the tip, so the pack's money lives solely in this row.
 *
 * Per-service and per-appointment breakdowns must not use this: a pack sale
 * has no appointment or service to attribute to. Per-staff revenue still
 * counts it, on the staff member whose user id sold the pack.
 */
export const REVENUE_CHARGE_REASONS = ["service_payment", "package_sale"] as const;
