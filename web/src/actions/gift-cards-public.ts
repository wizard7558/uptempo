"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { clientIpFrom } from "@/lib/http/client-ip";
import { withTenantDb } from "@/lib/db/tenant";
import { hasModule } from "@/lib/tenant/modules";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getStripe } from "@/lib/stripe/server";
import { getT } from "@/lib/terms/server";
import { normalizeGiftCardCode } from "@/lib/gift-cards/code";
import { findGiftCardByCode } from "@/lib/gift-cards/service";
import {
  createGiftCardCheckoutSession,
  maskEmail,
} from "@/lib/gift-cards/purchase";

const HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const PRESETS = [2500, 5000, 10000, 15000] as const;

const purchaseSchema = z.object({
  amountCents: z.number().int().min(1000).max(100_000),
  purchaserName: z.string().trim().min(1).max(80),
  purchaserEmail: z.string().trim().email().max(200),
  recipientName: z.string().trim().min(1).max(80),
  recipientEmail: z.string().trim().email().max(200),
  message: z.string().trim().max(200).optional(),
});

export type GiftCardShopInfo = {
  businessName: string;
  available: boolean;
  presets: readonly number[];
};

/** Public shop header. Online purchase needs the module and a connected account. */
export async function getGiftCardShopInfo(slug: string): Promise<GiftCardShopInfo | null> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return null;
  const available =
    Boolean(tenant.stripeConnectAccountId) && (await hasModule(slug, "gift_cards"));
  return { businessName: tenant.name, available, presets: PRESETS };
}

export type StartGiftCardPurchaseInput = {
  amountCents: number;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail: string;
  message?: string;
  website?: string;
};

export async function startGiftCardPurchase(
  slug: string,
  input: StartGiftCardPurchaseInput,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const te = await getT("errors", slug);
  if (input.website && input.website.trim() !== "") {
    return { success: false, error: te("giftCards.rateLimited") };
  }
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) {
    const amount = parsed.error.issues.some((issue) => issue.path[0] === "amountCents");
    return {
      success: false,
      error: te(amount ? "giftCards.amountRange" : "giftCards.invalidDetails"),
    };
  }
  if (!(await hasModule(slug, "gift_cards"))) {
    return { success: false, error: (await getT("giftCards", slug))("public.notAvailable") };
  }
  const ip = clientIpFrom(await headers());
  const limit = await consumeRateLimit({
    tenantSlug: slug,
    scope: "ip",
    key: `gc_buy:${ip}`,
    limit: 10,
    windowMs: HOUR_MS,
  });
  if (!limit.allowed) return { success: false, error: te("giftCards.rateLimited") };

  const started = await createGiftCardCheckoutSession(slug, parsed.data);
  if (!started.ok) {
    return {
      success: false,
      error: te(started.reason === "notSetUp" ? "giftCards.notSetUp" : "giftCards.checkoutFailed"),
    };
  }
  return { success: true, url: started.url };
}

export type GiftCardPurchaseStatus = {
  paid: boolean;
  amountCents: number;
  recipientEmailMasked: string;
};

/** Success page. Confirms the session belongs to this business. Never returns the code. */
export async function getGiftCardPurchaseStatus(
  slug: string,
  sessionId: string,
): Promise<GiftCardPurchaseStatus | null> {
  if (!sessionId.startsWith("cs_")) return null;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (
      session.metadata?.purpose !== "gift_card_purchase" ||
      session.metadata?.tenantSlug !== slug
    ) {
      return null;
    }
    const email = session.metadata.recipientEmail || session.customer_details?.email || "";
    return {
      paid: session.payment_status === "paid",
      amountCents: session.amount_total ?? 0,
      recipientEmailMasked: email ? maskEmail(email) : "",
    };
  } catch {
    return null;
  }
}

export async function checkGiftCardBalance(
  slug: string,
  code: string,
  website?: string,
): Promise<
  | { success: true; last4: string; balanceCents: number }
  | { success: false; error: string }
> {
  const te = await getT("errors", slug);
  if (website && website.trim() !== "") {
    return { success: false, error: te("giftCards.rateLimited") };
  }
  if (!(await hasModule(slug, "gift_cards"))) {
    return { success: false, error: te("giftCards.notFound") };
  }
  const ip = clientIpFrom(await headers());
  const limit = await consumeRateLimit({
    tenantSlug: slug,
    scope: "ip",
    key: `gc_balance:${ip}`,
    limit: 10,
    windowMs: FIFTEEN_MIN_MS,
  });
  if (!limit.allowed) return { success: false, error: te("giftCards.rateLimited") };

  if (!normalizeGiftCardCode(code)) {
    return { success: false, error: te("giftCards.notFound") };
  }
  const found = await withTenantDb(slug, (db, tables) => findGiftCardByCode(db, tables, code));
  if (!found || found.status !== "active") {
    return { success: false, error: te("giftCards.notFound") };
  }
  return { success: true, last4: found.last4, balanceCents: found.balanceCents };
}
