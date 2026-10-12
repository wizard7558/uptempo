# Booking & Services configuration

This document covers the stylist-requested service/booking capabilities and how
they work end to end. All of these are tenant-scoped (per salon) and ship via
tenant migrations **0027–0031**.

> **Migrations:** apply with `npm run migrate:tenants` (dev) and
> `npm run migrate:production` (prod). New tenants get everything automatically —
> `src/lib/tenant/provision.ts` replays every migration after the baseline.

## 1. Per-service price display (`services.price_display`)

Each service chooses how its price appears on the public booking page:

| Value      | Booking page shows |
|------------|--------------------|
| `show`     | exact price, e.g. `$85` (default) |
| `starting` | `From $85` |
| `hidden`   | no price |

Set it on **Services → edit a service → "Price shown to clients"**. Resolved in
`resolve-pricing.ts` and rendered by `services-step.tsx` (`priceLabel`).

## 2. Internal-only services (`services.online_bookable`)

Turn **"Bookable online"** off to keep a service internal: staff can still book
it from the dashboard, but it never appears on the public booking page. Use this
for things a client shouldn't self-book (e.g. keratin extensions) while still
offering a bookable **Consultation**. Filtered out in
`booking-public.ts → getStylistServices`.

## 3. Online booking audience (`salon_policies.online_booking_audience`)

Settings → Policies → **"Who can book online"**:

- `both` — everyone (default)
- `existing_only` — only clients already in the book may self-book
- `new_only` — only first-time clients may self-book

Enforced in `app/api/booking/verify-code/route.ts` after OTP verification, before
creating/looking up the client. Staff can always book anyone from the dashboard.

### Per-service audience (`services.booking_audience`)

On top of the salon-level gate, each service can restrict who may self-book it
online — Services → edit a service → **"Who can book this online"**:

- `all` — everyone (default)
- `new` — first-time clients only
- `returning` — returning clients only

"New" means zero appointments booked (same definition as
`appointments.client_status_at_booking`). The canonical use case: mark
**Consultation** as `all` and everything else `returning`, so new clients must
start with a consult while regulars book normally.

Two enforcement layers, both keyed off the identity-first booking wizard (the
client is always known before the service list renders):

- **Filter** — `getStylistServices()` (`src/actions/booking-public.ts`) hides
  ineligible services and returns `hiddenForNewClient` so the services step can
  tell first-timers some options are returning-client-only (with a friendly
  empty state if a salon restricts everything).
- **Boundary** — `confirmBooking()` re-validates every chosen service
  (audience AND `online_bookable`, which previously wasn't re-checked
  server-side) so a crafted request can't bypass the UI.

Eligibility logic lives in `src/lib/services/booking-audience.ts`
(`canClientBookService`, `isNewClient`) with an exhaustive test matrix. Staff
booking from the dashboard is never restricted. Tenant migration 0037.

## 4. Custom service categories (`service_categories` table)

Categories are salon-defined. Seven defaults (Cut, Color, Extensions, Style,
Treatment, Add-on, Other) are seeded; salons can add their own (e.g.
"Maintenance") inline from the service editor. `services.category` stores the
category **slug**. The booking page groups services by category in the salon's
configured order. Managed by `actions/service-categories.ts`. Custom categories
require the **pro** plan (`custom_categories` feature). Deleting a custom
category reassigns its services to `other`.

## 5. Service add-ons (`service_addons` table)

Attach optional add-on services to a primary service (e.g. a *weft install*
offered with a *partial color*). On **Services → edit → "Add-ons offered with
this service"**, pick any other services. At booking, after a client selects a
primary service, its add-ons appear as optional checkboxes underneath; selecting
one adds it as a normal appointment line item (price + duration roll up).
Requires the **pro** plan (`service_addons`). Data in
`actions/service-addons.ts`; booking UI in `services-step.tsx`.

## 6. Per-location booking links (query-param prefill)

Each location has a shareable link that pre-selects it and skips the location
step:

```
https://<salon-domain>/book/<salon-slug>?location=<locationId>
```

Copy it from **Settings → Locations → "Copy booking link"**. `?location=` accepts
a location id or an exact (case-insensitive) location name; resolved in
`book/[slug]/page.tsx` and auto-selected in `location-step.tsx`.

## 7. Deposits (`services.deposit_*`, `salon_policies.deposit_*`, `appointments.deposit_cents`)

Available on **every plan** (intentionally ungated).

### Configuration — two layers (override beats the global rule)

- **Salon global rule** (Settings → Policies → "Require a deposit at booking"):
  a default `percent`/`fixed` amount that applies to every service, optionally
  only to services at/above a **minimum duration** (e.g. `240` = "4+ hours").
- **Per-service override** (Services → edit → "Deposit"): `Use salon default`
  (inherit), `No deposit`, `Percent of price`, or `Fixed amount`.

Resolution is a pure, unit-tested function in `lib/services/deposits.ts`
(`resolveBookingDeposit`). Per service: an explicit override wins; otherwise the
global rule applies if enabled and the duration threshold is met.

### Money flow

1. **At booking** (`confirmBooking`): the deposit is resolved across all selected
   services, recorded on `appointments.deposit_cents`, and collected:
   - if the client already has a card on file → charged immediately off-session
     (`chargeBookingDeposit`, a `charges` row with `reason = 'deposit'`);
   - otherwise it's collected right after the client saves a card in the payment
     step (`payment-step.tsx`).
2. **At checkout** (`completeAppointment`): the collected deposit is credited
   against the amount due, exactly like a Beauty Bank credit — the client is
   never charged the deposit twice. Revenue is still recognized in full via the
   `service_payment` charge; the `deposit` charge is a prepayment, not separate
   service revenue, so analytics (which sum `reason = 'service_payment'`) are not
   double-counted.
3. **On free cancellation** (`cancelBooking`): the deposit is automatically
   refunded (`refundBookingDepositForTenant`). On a fee-bearing cancellation or
   no-show, the deposit is retained.

### Notes / future work

- Deposits are charged off-session (reusing the salon's trusted card-on-file
  pipeline), so US cards that require 3DS on every charge could be declined; the
  failed `deposit` charge is recorded for the salon to retry.
- Fee-bearing cancellations/no-shows currently retain the deposit AND can charge
  the configured fee separately; salons that want the deposit to offset the fee
  should set fees with that in mind.
