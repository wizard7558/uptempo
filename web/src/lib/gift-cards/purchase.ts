import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getConnectChargeParams } from "@/lib/stripe/connect-charge-params";
import { getStripe } from "@/lib/stripe/server";
import { getBaseUrl } from "@/lib/utils";
import { issueGiftCard } from "./service";
import { sendGiftCardEmail } from "./email";

export type GiftCardCheckoutInput = {
  amountCents: number;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string;
  recipientEmail: string;
  message?: string | null;
};

export type GiftCardCheckoutStart =
  | { ok: true; url: string }
  | { ok: false; reason: "notSetUp" | "failed" };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function paymentIntentId(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id;
}

/** First character of the mailbox, then the domain. `jo@example.com` becomes `j***@example.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/**
 * Hosted Checkout on the business's connected account. The gift card code is
 * not created here. The webhook creates it after Stripe says the session is paid.
 */
export async function createGiftCardCheckoutSession(
  slug: string,
  input: GiftCardCheckoutInput,
): Promise<GiftCardCheckoutStart> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant?.stripeConnectAccountId) return { ok: false, reason: "notSetUp" };
  const connect = await getConnectChargeParams(slug, input.amountCents);
  if (!connect) return { ok: false, reason: "notSetUp" };

  const business = tenant.name || "Uptempo";
  const message = (input.message ?? "").slice(0, 200);
  const base = getBaseUrl();
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    customer_email: input.purchaserEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.amountCents,
          product_data: { name: `Gift card for ${business}` },
        },
      },
    ],
    success_url: `${base}/gift/${slug}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/gift/${slug}`,
    payment_intent_data: {
      transfer_data: { destination: connect.connectAccountId },
      ...(connect.platformFeeCents > 0
        ? { application_fee_amount: connect.platformFeeCents }
        : {}),
      metadata: { purpose: "gift_card_purchase", tenantSlug: slug },
    },
    metadata: {
      purpose: "gift_card_purchase",
      tenantSlug: slug,
      amountCents: String(input.amountCents),
      purchaserName: input.purchaserName,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      message,
      platformFeeCents: String(connect.platformFeeCents),
    },
  };

  try {
    const session = await getStripe().checkout.sessions.create(params);
    if (!session.url) return { ok: false, reason: "failed" };
    return { ok: true, url: session.url };
  } catch (err) {
    console.error("[gift-cards] checkout session failed", slug, err);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Issues the card for a paid Checkout Session. A second delivery of the same
 * session does not create a second card. The code is emailed and then dropped.
 */
export async function issueGiftCardFromSession(
  session: Stripe.Checkout.Session,
): Promise<{ issued: boolean }> {
  const meta = session.metadata ?? {};
  if (meta.purpose !== "gift_card_purchase") return { issued: false };
  if (session.payment_status !== "paid") return { issued: false };
  const slug = meta.tenantSlug;
  if (!slug) return { issued: false };
  const amountCents = session.amount_total;
  if (!Number.isInteger(amountCents) || amountCents == null) return { issued: false };

  const recipientEmail = meta.recipientEmail || null;
  const recipientName = meta.recipientName || null;
  const purchaserName = meta.purchaserName || null;
  const message = meta.message ? meta.message.slice(0, 200) : null;
  const platformFeeCents = Number(meta.platformFeeCents ?? 0);

  const issued = await withTenantDb(slug, async (db, tables) => {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: tables.giftCards.id })
        .from(tables.giftCards)
        .where(eq(tables.giftCards.stripeCheckoutSessionId, session.id))
        .limit(1);
      if (existing) return null;
      try {
        return await issueGiftCard(tx, tables, {
          amountCents,
          source: "online",
          purchaserName,
          purchaserEmail: session.customer_details?.email ?? null,
          recipientName,
          recipientEmail,
          message,
          stripeCheckoutSessionId: session.id,
          stripePaymentIntentId: paymentIntentId(session),
          platformFeeCents: Number.isFinite(platformFeeCents) ? platformFeeCents : 0,
        });
      } catch (err) {
        const info = pgErrorInfo(err);
        if (info.code === "23505" && info.constraint === "gift_cards_checkout_session_unique") {
          return null;
        }
        throw err;
      }
    });
  });

  if (!issued) return { issued: false };

  if (recipientEmail) {
    try {
      await sendGiftCardEmail(slug, {
        giftCardId: issued.id,
        to: recipientEmail,
        recipientName,
        purchaserName,
        amountCents,
        code: issued.code,
        message,
      });
    } catch (err) {
      console.error("[gift-cards] email failed", issued.id, err);
    }
  }

  try {
    await withTenantDb(slug, async (db, tables) => {
      await db
        .insert(tables.alerts)
        .values({
          type: "gift_card_sold",
          severity: "info",
          title: "Gift card sold",
          body: `${money(amountCents)} gift card for ${recipientName || "a recipient"}`,
          dedupeKey: `gift_card_sold:${session.id}`,
          data: { giftCardId: issued.id },
        })
        .onConflictDoNothing({ target: tables.alerts.dedupeKey });
    });
  } catch (err) {
    console.error("[gift-cards] alert failed", issued.id, err);
  }

  return { issued: true };
}
