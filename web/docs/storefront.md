# Retail Storefront

Lets a salon sell retail products: stylist-side product management
(**Settings → Storefront**) plus a client-facing store at **`/store/:slug`**
with cart, Stripe checkout (pickup or flat-rate shipping), flat sales tax, and
order records.

## Managing products

**Settings → Storefront** (`/settings/products`, owner-only). Each product has:

- **Name**, **brand**, **size** (e.g. "118 ml / 4 fl oz")
- **Retail price** (what the client pays) and optional **your cost** (wholesale,
  for margin)
- **Photo URL** (paste a link; upload UI is future work)
- **Recommended for** — hair-profile tags (blonde, brunette, color-treated,
  extensions, curly, fine, damaged, …) that will drive client recommendations
- **Show in storefront** toggle (`is_active`)

Add via the "Add product" dialog; edit/remove from each product card. Removing is
a hard delete (there are no orders referencing products yet).

## Pieces

| Concern | Location |
| --- | --- |
| Table (tenant) | `products` in `src/lib/db/tenant-schema/tables.ts` |
| Migration | `src/lib/tenant/migrations/0035-products.ts` |
| Validator | `src/lib/validators/product.ts` (`PRODUCT_HAIR_TYPES`) + tests |
| Actions | `src/actions/products.ts` (list/create/update/delete) |
| Admin page + UI | `src/app/(admin)/settings/products/{page,client}.tsx` |
| Settings link | `src/app/(admin)/settings/page.tsx` ("Storefront") |

`hair_types` is a `jsonb` string array (defaults `[]`); money is in cents.

## Emma's starting catalog

Seeded for `test-salon` (editable in the UI):

| Product | Brand | Size | Price |
| --- | --- | --- | --- |
| K18 AirWash Dry Shampoo | K18 | 118 ml / 4 fl oz | $32.00 |
| Milbon Froth Blowout Foam | Milbon | 7.1 fl oz | $40.00 |
| Color Wow Raise the Root Thicken + Lift Spray | Color Wow | 150 ml / 5 fl oz | $26.00 |
| Color Wow Dream Coat Supernatural Spray | Color Wow | 200 ml / 6.7 fl oz | $30.00 |
| K18 Leave-In Molecular Repair Hair Mask | K18 | 50 ml / 1.7 fl oz | $75.00 |

(K18/Milbon prices are typical retail starting points — Emma confirms/edits;
Color Wow prices are the brand's listed retail.)

## Client-facing store (`/store/:slug`)

Public (guest checkout allowed). Active products render in catalog order; when
a signed-in booking client has hair-profile tags, matching products sort first
under "Picked for you". Clients are tagged from their admin profile (Hair
profile card → `clients.hair_types`); products match when they share a tag or
are tagged `all`.

**Checkout** is a Stripe Checkout Session with inline `price_data` (no
pre-synced Stripe Products):

- **Prices come from the DB** — client-submitted prices are never trusted; qty
  is clamped (max 10/item, 25 items).
- **Destination charge** to the salon's Connect account, with the tier revenue
  percentage as `application_fee_amount` on the **product subtotal only** (tax
  and shipping pass through to the salon).
- **Sales tax** is a salon-configured flat rate (`salon_policies.retail_tax_bps`,
  set as a % in Settings → Storefront) added as its own line item. Deliberate
  v1 simplicity — a single-location salon knows its local rate; Stripe Tax
  automation can replace this later. `0` = no tax collected.
- **Fulfillment**: pickup (always) or flat-rate shipping when
  `retail_ship_flat_cents` is set (null = pickup only). Shipping collects a US
  address via Stripe.
- Success page confirms directly from Stripe (doesn't race the webhook).

**Orders**: the `checkout.session.completed` webhook (metadata
`purpose=storefront_order`) records the order — idempotent via the unique
session-id index, so Stripe retries/replays never duplicate — and raises a
dashboard bell alert. Owners see orders in Settings → Storefront and mark them
fulfilled.

**Billing integration**: retail `application_fee` amounts count toward the
monthly $50-floor reconciliation, and retail subtotals count as revenue in the
fee preview — retail is never double-charged by the floor top-up.

### Phase-2 pieces

| Concern | Location |
| --- | --- |
| Store page + cart UI | `src/app/(booking)/store/[slug]/{page,store-client}.tsx` (+ `success/page.tsx`) |
| Public actions | `src/actions/storefront.ts` |
| Checkout + order recording | `src/lib/services/storefront.ts` (+ tests) |
| Orders table / client tags / retail settings | tenant migration `0036-storefront-checkout.ts` |
| Webhook case | `checkout.session.completed` in `src/app/api/stripe/webhook/route.ts` |
| Admin orders + settings | `src/actions/orders.ts`, `getStorefrontSettings`/`updateStorefrontSettings` in `src/actions/products.ts`, components in `src/components/settings/` |
| Client hair profile | `updateClientHairTypes` in `src/actions/clients.ts`, card in `src/components/clients/` |
| Slug routing | `store` added to the tenant path regex in `src/middleware.ts` |

## Later

- AI-generated product photos; subscribe & save for consumables; inventory
  counts; Stripe Tax automation; refunds from the orders UI.
