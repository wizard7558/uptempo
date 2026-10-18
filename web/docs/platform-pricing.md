# Platform Pricing

What a business pays Uptempo on card payments in hosted mode: **one card
processing rate**, taken from each client card payment before it reaches the
business's bank. There is no monthly minimum and no per-plan tier. Self-hosting
(`UPTEMPO_MODE=single`) pays nothing.

The rate is shown to the business as "Card processing: 5%" and nothing more. It
is not described as a payment processor's fee.

## Configuration

| Variable | Default | Valid | Meaning |
| --- | --- | --- | --- |
| `PLATFORM_PROCESSING_FIXED_CENTS` | `0` | integer 0 to 100 | Fixed cents added to each fee. |

The hosted card rate is 500 basis points. `PLATFORM_PROCESSING_RATE_BPS` does not change it. An invalid fixed-cents value logs one error and falls back to 0.

## Source of truth

`src/lib/billing/processing-fee.ts` is the only copy of the math:

- `processingRateBps(tenant)` — 0 in single mode or when `tenants.comped = 1`;
  otherwise 500.
- `processingFeeCents(amountCents, tenant)` — `round(amount x bps / 10000) +
  fixed`, capped at `amount - 1`; 0 for a zero amount or zero rate.
- `processingFeePercent(tenant)` — the rate as a percent, for Stripe's
  `application_fee_percent` on client membership subscriptions.
- `processingRateLabel(bps)` — "5%", "0.5%", "3.5%".

## Where it is applied

Every client charge reads the fee through `getConnectChargeParams`
(`src/lib/stripe/connect-charge-params.ts`): checkout (full and remainder), the
no-show and late-cancellation fees, package sales, booking deposits, stored-value
top-ups, and gift card purchases. Two paths compute it directly: client
membership subscriptions (`application_fee_percent`, `src/actions/membership.ts`)
and storefront product sessions (`application_fee_amount` on the product
subtotal, `src/lib/services/storefront.ts`). `src/lib/billing/charge-paths.test.ts`
pins the Stripe call for each.

## Existing businesses

Migration `0032_card_processing_rate` adds two columns to `tenants`:

- `comped` (default 0) is set to 1 where `platform_fee_percent = 0`, the old
  exemption. A comped business pays no processing fee.
- `processing_rate_bps` (null, 0 to 1000) is backfilled with each business's old
  per-charge rate: `platform_fee_percent x 100`, else the plan default (starter
  50, pro 100, business 200). It keeps that rate until its billing switch sets it
  back to null. New businesses have null and follow the env default.

`plan`, `platform_fee_percent`, `billing_enabled`, `platform_payment_method_id`,
and `assistant_seats` are frozen and are dropped once every business has moved.
The `platform_charges` table stays as history; nothing writes to it anymore.

## Settings

Settings, Billing & Payouts shows the business's rate in
`src/components/settings/processing-rate-card.tsx`: "Card processing: 5%" with
"Taken from each card payment before it reaches your bank", or "Card processing:
no charge" for a comped business. The card does not render in single mode.
