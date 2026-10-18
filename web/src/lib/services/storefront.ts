import type Stripe from "stripe";
import { inArray } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getTenantTerms } from "@/lib/tenant/industry";
import { createTermsT } from "@/lib/terms/translator";
import { getStripe } from "@/lib/stripe/server";
import { getBaseUrl } from "@/lib/utils";
import { processingFeeCents } from "@/lib/billing/processing-fee";
import { isSingleMode } from "@/lib/config/mode";

/**
 * Storefront checkout. The card processing fee is `processingFeeCents` on the
 * product subtotal. Tax and shipping are not part of that base.
 */

export const MAX_QTY_PER_ITEM = 10;
export const MAX_CART_ITEMS = 25;

export interface CartItemInput {
  productId: string;
  quantity: number;
}

export interface PricedCartItem {
  productId: string;
  name: string;
  quantity: number;
  unitCents: number;
}

export interface OrderPricing {
  items: PricedCartItem[];
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  platformFeeCents: number;
}

/**
 * Pure pricing math: subtotal from server-side prices, flat tax on the
 * subtotal, flat shipping when shipping. The fee is whatever `feeOnSubtotal`
 * returns for that subtotal. Throws on an empty cart.
 */
export function priceOrder(opts: {
  items: PricedCartItem[];
  taxBps: number;
  shippingCents: number;
  feeOnSubtotal?: (subtotalCents: number) => number;
}): OrderPricing {
  const items = opts.items.filter((i) => i.quantity > 0);
  if (items.length === 0) throw new Error("Cart is empty");

  const subtotalCents = items.reduce(
    (sum, i) => sum + i.unitCents * i.quantity,
    0,
  );
  const taxBps = Number.isFinite(opts.taxBps) && opts.taxBps > 0 ? opts.taxBps : 0;
  const taxCents = Math.round((subtotalCents * taxBps) / 10_000);
  const shippingCents = Math.max(0, Math.round(opts.shippingCents || 0));
  const totalCents = subtotalCents + taxCents + shippingCents;
  const quoted = opts.feeOnSubtotal?.(subtotalCents) ?? 0;
  const platformFeeCents =
    Number.isFinite(quoted) && quoted > 0 ? Math.round(quoted) : 0;

  return { items, subtotalCents, taxCents, shippingCents, totalCents, platformFeeCents };
}

export type CreateCheckoutResult =
  | { success: true; url: string }
  | { success: false; error: string };

/**
 * Validate a cart against the salon's live catalog and create a Stripe
 * Checkout Session on the salon's behalf. Prices always come from the DB —
 * client-supplied prices are never trusted.
 */
export async function createStorefrontCheckoutSession(opts: {
  slug: string;
  items: CartItemInput[];
  fulfillment: "pickup" | "ship";
  clientId: string | null;
}): Promise<CreateCheckoutResult> {
  const { slug, fulfillment, clientId } = opts;

  // Sanitize cart shape.
  const wanted = new Map<string, number>();
  for (const item of opts.items ?? []) {
    if (typeof item?.productId !== "string" || item.productId.length === 0) continue;
    const qty = Math.min(MAX_QTY_PER_ITEM, Math.max(0, Math.floor(item.quantity ?? 0)));
    if (qty === 0) continue;
    wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + qty);
    if (wanted.size > MAX_CART_ITEMS) {
      return { success: false, error: "Too many items in the cart" };
    }
  }
  if (wanted.size === 0) return { success: false, error: "Your cart is empty" };

  const tenant = await getTenantBySlug(slug);
  const t = createTermsT(await getTenantTerms(slug), "errors");
  if (!tenant) return { success: false, error: t("storefront.notFound") };
  if (!tenant.stripeConnectAccountId) {
    return { success: false, error: t("storefront.notSetUp") };
  }

  // Resolve products + retail settings inside the tenant schema.
  const { rows, taxBps, shipFlatCents } = await withTenantDb(
    slug,
    async (db, t) => {
      const rows = await db
        .select({
          id: t.products.id,
          name: t.products.name,
          brand: t.products.brand,
          priceCents: t.products.priceCents,
          photoUrl: t.products.photoUrl,
          isActive: t.products.isActive,
        })
        .from(t.products)
        .where(inArray(t.products.id, Array.from(wanted.keys())));
      const [policies] = await db
        .select({
          taxBps: t.businessSettings.retailTaxBps,
          shipFlatCents: t.businessSettings.retailShipFlatCents,
        })
        .from(t.businessSettings)
        .limit(1);
      return {
        rows,
        taxBps: policies?.taxBps ?? 0,
        shipFlatCents: policies?.shipFlatCents ?? null,
      };
    },
  );

  const found = new Map(rows.map((r) => [r.id, r]));
  const priced: PricedCartItem[] = [];
  for (const [productId, quantity] of wanted) {
    const product = found.get(productId);
    if (!product || product.isActive !== 1) {
      return { success: false, error: "A product in your cart is no longer available" };
    }
    priced.push({
      productId,
      name: [product.brand, product.name].filter(Boolean).join(" ").trim() || product.name,
      quantity,
      unitCents: product.priceCents,
    });
  }

  if (fulfillment === "ship" && shipFlatCents == null) {
    return { success: false, error: t("storefront.pickupOnly") };
  }
  const shippingCents = fulfillment === "ship" ? (shipFlatCents ?? 0) : 0;

  const pricing = priceOrder({
    items: priced,
    taxBps,
    shippingCents,
    feeOnSubtotal: (subtotalCents) => processingFeeCents(subtotalCents, tenant),
  });

  const baseUrl = getBaseUrl();
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = pricing.items.map(
    (item) => {
      const photo = found.get(item.productId)?.photoUrl;
      return {
        quantity: item.quantity,
        price_data: {
          currency: "usd",
          unit_amount: item.unitCents,
          product_data: {
            name: item.name,
            metadata: { productId: item.productId },
            ...(photo && photo.startsWith("https://") ? { images: [photo] } : {}),
          },
        },
      };
    },
  );
  if (pricing.taxCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: pricing.taxCents,
        product_data: { name: "Sales tax", metadata: { isTax: "1" } },
      },
    });
  }

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: lineItems,
    success_url: `${baseUrl}/store/${slug}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/store/${slug}`,
    payment_intent_data: {
      ...(isSingleMode()
        ? {}
        : { transfer_data: { destination: tenant.stripeConnectAccountId } }),
      ...(pricing.platformFeeCents > 0
        ? { application_fee_amount: pricing.platformFeeCents }
        : {}),
      metadata: { purpose: "storefront_order", tenantSlug: slug },
    },
    metadata: {
      purpose: "storefront_order",
      tenantSlug: slug,
      fulfillment,
      ...(clientId ? { clientId } : {}),
      subtotalCents: String(pricing.subtotalCents),
      taxCents: String(pricing.taxCents),
      shippingCents: String(pricing.shippingCents),
      platformFeeCents: String(pricing.platformFeeCents),
    },
  };

  if (fulfillment === "ship") {
    params.shipping_address_collection = { allowed_countries: ["US"] };
    params.shipping_options = [
      {
        shipping_rate_data: {
          display_name: "Flat-rate shipping",
          type: "fixed_amount",
          fixed_amount: { amount: pricing.shippingCents, currency: "usd" },
        },
      },
    ];
  }

  try {
    const session = await getStripe().checkout.sessions.create(params);
    if (!session.url) return { success: false, error: "Could not start checkout" };
    return { success: true, url: session.url };
  } catch (err) {
    console.error("[Storefront] checkout session failed:", err);
    return { success: false, error: "Could not start checkout" };
  }
}

/**
 * Record a completed storefront Checkout Session as an order (idempotent on
 * the session id) and raise a dashboard alert. Called from the Stripe webhook.
 */
export async function recordStorefrontOrder(
  session: Stripe.Checkout.Session,
): Promise<{ recorded: boolean }> {
  const slug = session.metadata?.tenantSlug;
  if (!slug) return { recorded: false };

  // Item snapshot from Stripe line items (skip the synthetic tax line).
  const lineItems = await getStripe().checkout.sessions.listLineItems(session.id, {
    limit: 100,
    expand: ["data.price.product"],
  });
  const items = lineItems.data
    .map((li) => {
      const product = li.price?.product;
      const meta =
        product && typeof product === "object" && "metadata" in product
          ? (product.metadata as Record<string, string>)
          : {};
      return {
        productId: meta.productId ?? null,
        isTax: meta.isTax === "1",
        name: li.description ?? "Item",
        quantity: li.quantity ?? 1,
        unitCents: li.price?.unit_amount ?? 0,
      };
    })
    .filter((li) => !li.isTax)
    .map(({ productId, name, quantity, unitCents }) => ({
      productId,
      name,
      quantity,
      unitCents,
    }));

  const meta = session.metadata ?? {};
  const subtotalCents = Number(meta.subtotalCents ?? 0);
  const taxCents = Number(meta.taxCents ?? 0);
  const shippingCents = Number(meta.shippingCents ?? 0);
  const platformFeeCents = Number(meta.platformFeeCents ?? 0);
  const fulfillment = meta.fulfillment === "ship" ? "ship" : "pickup";
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  const shipping =
    (session as unknown as { shipping_details?: unknown }).shipping_details ??
    session.customer_details?.address ??
    null;

  return withTenantDb(slug, async (db, t) => {
    const inserted = await db
      .insert(t.orders)
      .values({
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        clientId: meta.clientId ?? null,
        customerName: session.customer_details?.name ?? null,
        customerEmail: session.customer_details?.email ?? null,
        items,
        subtotalCents,
        taxCents,
        shippingCents,
        totalCents: session.amount_total ?? subtotalCents + taxCents + shippingCents,
        platformFeeCents,
        fulfillment,
        shippingAddress: fulfillment === "ship" ? shipping : null,
        status: "paid",
      })
      .onConflictDoNothing({ target: t.orders.stripeCheckoutSessionId })
      .returning({ id: t.orders.id });

    if (inserted.length === 0) return { recorded: false }; // replayed webhook

    const itemsSummary = items
      .map((i) => `${i.quantity}× ${i.name}`)
      .join(", ");
    await db.insert(t.alerts).values({
      type: "storefront_order",
      severity: "info",
      title: "New storefront order",
      body: `${session.customer_details?.name ?? "A customer"} ordered ${itemsSummary} (${fulfillment === "ship" ? "shipping" : "pickup"}).`,
      data: { orderId: inserted[0].id },
      dedupeKey: null,
    });

    return { recorded: true };
  });
}
