"use server";

import { asc, eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { getT } from "@/lib/terms/server";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { getStripe } from "@/lib/stripe/server";
import {
  createStorefrontCheckoutSession,
  type CartItemInput,
  type CreateCheckoutResult,
} from "@/lib/services/storefront";
import { listDefinitions } from "@/lib/custom-fields/service";
import { isRecommendedProduct, productMatchTags } from "@/lib/custom-fields/values";

export interface StorefrontProduct {
  id: string;
  name: string;
  brand: string | null;
  description: string | null;
  size: string | null;
  priceCents: number;
  photoUrl: string | null;
  tags: string[];
  /** True when the signed-in client's profile tags match this product. */
  recommended: boolean;
}

export interface StorefrontData {
  businessName: string;
  products: StorefrontProduct[];
  /** Whether flat-rate shipping is offered (else pickup only). */
  shipAvailable: boolean;
  shippingCents: number | null;
  taxBps: number;
  client: { id: string; name: string } | null;
}

/**
 * Everything the public storefront page needs. Recommended products (matching
 * the signed-in client's profile tags) sort first.
 */
export async function getStorefront(slug: string): Promise<StorefrontData | null> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant || tenant.status !== "active" || tenant.schemaVersion <= 0) {
    return null;
  }

  // Shop turned off: show the existing empty state instead of a 404, so the
  // native Shop tab keeps working.
  if (!isModuleEnabled(tenant.modules, "storefront")) {
    return {
      businessName: tenant.name,
      products: [],
      shipAvailable: false,
      shippingCents: null,
      taxBps: 0,
      client: null,
    };
  }

  const sessionClientId = await getBookingSession();
  const defs = await listDefinitions(slug, "client");

  return withTenantDb(slug, async (db, t) => {
    // Products, retail settings, and the client lookup are independent — one
    // parallel round trip instead of three serial ones (this backs the native
    // app's Shop tab).
    const [rows, policyRows, clientRows] = await Promise.all([
      db
        .select()
        .from(t.products)
        .where(eq(t.products.isActive, 1))
        .orderBy(asc(t.products.sortOrder), asc(t.products.name)),
      db
        .select({
          taxBps: t.businessSettings.retailTaxBps,
          shipFlatCents: t.businessSettings.retailShipFlatCents,
        })
        .from(t.businessSettings)
        .limit(1),
      sessionClientId
        ? db
            .select({
              id: t.clients.id,
              name: t.clients.name,
              attributes: t.clients.attributes,
            })
            .from(t.clients)
            .where(eq(t.clients.id, sessionClientId))
            .limit(1)
        : Promise.resolve([]),
    ]);

    const [policies] = policyRows;

    let client: StorefrontData["client"] = null;
    const [row] = clientRows;
    if (row) {
      client = { id: row.id, name: row.name };
    }

    const clientTags = productMatchTags(defs, row?.attributes ?? {});
    const products: StorefrontProduct[] = rows.map((p) => {
      const tags = p.tags ?? [];
      return {
        id: p.id,
        name: p.name,
        brand: p.brand,
        description: p.description,
        size: p.size,
        priceCents: p.priceCents,
        photoUrl: p.photoUrl,
        tags,
        recommended: isRecommendedProduct(tags, clientTags),
      };
    });
    // Recommended first, otherwise keep catalog order.
    products.sort((a, b) => Number(b.recommended) - Number(a.recommended));

    return {
      businessName: tenant.name,
      products,
      shipAvailable: policies?.shipFlatCents != null,
      shippingCents: policies?.shipFlatCents ?? null,
      taxBps: policies?.taxBps ?? 0,
      client,
    };
  });
}

/**
 * Start Stripe Checkout for a cart. Public (guest checkout allowed); the
 * signed-in booking client, when present, is attached to the order.
 */
export async function createStorefrontCheckout(
  slug: string,
  input: { items: CartItemInput[]; fulfillment: "pickup" | "ship" },
): Promise<CreateCheckoutResult> {
  if (!(await hasModule(slug, "storefront"))) {
    return {
      success: false,
      error: (await getT("errors", slug))("storefront.closed"),
    };
  }
  const clientId = await getBookingSession();
  return createStorefrontCheckoutSession({
    slug,
    items: input.items,
    fulfillment: input.fulfillment === "ship" ? "ship" : "pickup",
    clientId,
  });
}

export interface OrderConfirmation {
  paid: boolean;
  totalCents: number;
  fulfillment: "pickup" | "ship";
  customerEmail: string | null;
}

/**
 * Success-page confirmation, straight from Stripe (does not depend on the
 * webhook having landed). Verifies the session belongs to this salon.
 */
export async function getOrderConfirmation(
  slug: string,
  sessionId: string,
): Promise<OrderConfirmation | null> {
  if (!sessionId.startsWith("cs_")) return null;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (
      session.metadata?.purpose !== "storefront_order" ||
      session.metadata?.tenantSlug !== slug
    ) {
      return null;
    }
    return {
      paid: session.payment_status === "paid",
      totalCents: session.amount_total ?? 0,
      fulfillment: session.metadata?.fulfillment === "ship" ? "ship" : "pickup",
      customerEmail: session.customer_details?.email ?? null,
    };
  } catch {
    return null;
  }
}
