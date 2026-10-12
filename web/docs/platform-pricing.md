# Platform Pricing

What a salon pays Uptempo. The model is a **monthly floor with the per-tier
revenue percentage on top**:

```
monthly platform fee = max($50, tierPercent% × monthly revenue)
```

The $50 floor covers revenue up to the break-even point (floor ÷ percent); above
that, the salon pays the tier percentage. Percentages stay on the existing
tiers, with an optional per-tenant override.

| Plan | Rate | $50 covers up to | Example: $10k/mo |
| --- | --- | --- | --- |
| Starter | 0.5% | $10,000/mo | $50 (floor) |
| Pro | 1% | $5,000/mo | $100 |
| Business | 2% | $2,500/mo | $200 |

A per-tenant override (`tenants.platform_fee_percent`) wins when set; **`0` is a
full exemption** — no percentage and no floor.

## Source of truth

`src/lib/billing/platform-pricing.ts` is the single source of truth:

- `PLATFORM_MONTHLY_FLOOR_CENTS` — the $50 floor.
- `PLAN_FEE_PERCENT` — per-plan defaults.
- `feePercentForTenant(tenant)` — resolves override → plan default → env fallback.
  The per-transaction Stripe `application_fee` path (`src/actions/membership.ts`)
  now delegates here, so the fee percentage is defined in exactly one place.
- `computePlatformFee(percent, revenueCents)` / `platformFeeForTenant(...)` —
  the `max(floor, percent × revenue)` math, returning a full breakdown
  (percent fee, charge, whether the floor binds, break-even revenue).

Fully unit-tested in `platform-pricing.test.ts`.

## Two ways the fee is realized

1. **Per-transaction** — the tier percentage is taken as a Stripe Connect
   `application_fee` on each appointment/membership charge. This collects the
   `% × revenue` portion continuously.
2. **The $50 floor (monthly top-up)** — a monthly job charges the salon the
   shortfall so they pay at least $50/month: `max(0, $50 − application fees
   already collected)`. Charged to the salon's card on the platform account; the
   charge stays with the platform (no Connect transfer). Together these give
   `max($50, % × revenue)`.

## Live paid billing (per-tenant opt-in)

Billing is **off by default** (`tenants.billing_enabled = 0`) so beta salons stay
free. Flip a salon onto paid billing with:

```
# dev
npx tsx scripts/set-tenant-billing.ts <slug> on
npx tsx scripts/set-tenant-billing.ts --list        # see everyone's status

# production (pin the prod DATABASE_URL first)
npx vercel env pull .env.production.local --environment=production
set -a && source .env.production.local && set +a && npx tsx scripts/set-tenant-billing.ts <slug> on
rm .env.production.local
```

Once enabled, the salon owner sees a **Platform billing** card on Settings →
Billing to save a card (Stripe SetupIntent + PaymentElement), and their recent
charges. The monthly cron then bills them.

### Pieces

| Concern | Location |
| --- | --- |
| Per-tenant flag + platform customer/card | `tenants.billing_enabled`, `.platform_stripe_customer_id`, `.platform_payment_method_id` |
| Charge ledger (idempotency) | `platform_charges` table (unique on tenant + period) |
| Migration | `drizzle/0020_platform_billing.sql` |
| Billing math | `computeMonthlyBilling()` in `src/lib/billing/platform-pricing.ts` |
| Reconcile + charge one tenant | `billTenantForPeriod()` in `src/lib/services/platform-billing.ts` |
| Monthly cron | `src/app/api/cron/charge-platform-fees/route.ts` (`0 6 1 * *`, CRON_SECRET) |
| Owner actions (setup intent, save card, status) | `src/actions/platform-billing.ts` |
| Card + history UI | `src/components/settings/platform-billing-card.tsx` |
| Enable/disable + list | `scripts/set-tenant-billing.ts` |
| Tests | `src/lib/services/platform-billing.test.ts`, `platform-pricing.test.ts` |

### Idempotency & safety

- One `platform_charges` row per (tenant, period); `succeeded`/`skipped` are
  terminal, so re-running the cron never double-bills.
- The Stripe PaymentIntent uses idempotency key `platform-fee:<slug>:<period>`.
- Off-session charge; failures are recorded (`failed` / `no_payment_method`)
  rather than throwing, and one tenant failing never blocks the others.
- The Stripe webhook ignores `purpose: "platform_fee"` PaymentIntents (they're
  recorded synchronously by the cron).

### Known limitation

`feesCollectedCents` is summed from tenant `charges.platform_fee_cents`
(appointment/checkout application fees). Membership-subscription application fees
aren't yet included, so a membership-heavy salon could be topped up slightly more
toward the floor. Bounded by the $50 floor. Refine later by reading platform
application fees from the Stripe API per connected account.

## Billing preview

`getPlatformFeePreview()` (`src/actions/billing-preview.ts`) computes the current
salon's completed-service revenue for the calendar month to date (UTC, sourced
from appointment line items so cash work counts) and returns the fee breakdown.
It is surfaced on **Settings → Billing & Payouts** via `PlatformFeePreviewCard`.
The footer note reflects the salon's state: "no fees charged during your beta"
until `billing_enabled` is on, then "billed monthly to your card on file."
