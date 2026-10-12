import { eq } from "drizzle-orm";
import { GiftCardEmail } from "@/emails/gift-card";
import { sendEmail } from "@/lib/email/send";
import { getEmailBranding } from "@/lib/email/branding";
import { withTenantDb } from "@/lib/db/tenant";
import { getEmailT } from "@/lib/terms/email";
import { getBaseUrl } from "@/lib/utils";
import { formatGiftCardCode } from "./code";

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Emails the code to the recipient. The code is not put in a URL.
 * On success, marks the card delivered. A send failure is logged and ignored.
 */
export async function sendGiftCardEmail(
  slug: string,
  input: {
    giftCardId: string;
    to: string;
    recipientName: string | null;
    purchaserName: string | null;
    amountCents: number;
    code: string;
    message: string | null;
  },
): Promise<boolean> {
  const [branding, t] = await Promise.all([
    getEmailBranding(slug),
    getEmailT(slug, "emails"),
  ]);
  const business = branding.salonName;
  const purchaser = input.purchaserName?.trim() || business;
  const formatted = formatGiftCardCode(input.code);
  try {
    const result = await sendEmail({
      to: input.to,
      subject: t("giftCard.subject", { purchaser, business }),
      react: GiftCardEmail({
        t,
        salonName: business,
        purchaser,
        amount: money(input.amountCents),
        code: formatted,
        message: input.message,
        balanceUrl: `${getBaseUrl()}/gift/${slug}/balance`,
        logoUrl: branding.logoUrl,
        brandColor: branding.brandColor,
      }),
      salonName: business,
    });
    if (!result.success) {
      console.error("[gift-cards] email was not sent", input.giftCardId);
      return false;
    }
    await withTenantDb(slug, async (db, tables) => {
      await db
        .update(tables.giftCards)
        .set({ deliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(tables.giftCards.id, input.giftCardId));
    });
    return true;
  } catch (err) {
    console.error("[gift-cards] email failed", input.giftCardId, err);
    return false;
  }
}
