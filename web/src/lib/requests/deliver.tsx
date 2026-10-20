import { sendEmail } from "@/lib/email/send";
import { getEmailBranding } from "@/lib/email/branding";
import { sendSms } from "@/lib/sms/send";
import { getEmailT } from "@/lib/terms/email";
import { tenantPublicBaseUrl } from "@/lib/booking/public-url";
import { formatCurrency } from "@/lib/format";
import { QuoteReadyEmail } from "@/emails/quote-ready";
import { loadQuoteForDelivery } from "./deliver-data";

/** Quote pages live under the business's booking path so the tenant comes from the URL. */
export function absoluteQuoteUrl(slug: string, token: string): string {
  return `${tenantPublicBaseUrl(slug)}/book/${slug}/quote/${token}`;
}

/**
 * Tells the client their quote is ready: an email when they have an address,
 * a text when they have a phone. Each channel is independent and best effort.
 */
export async function deliverQuote(slug: string, quoteId: string): Promise<void> {
  const data = await loadQuoteForDelivery(slug, quoteId);
  if (!data) return;
  const link = absoluteQuoteUrl(slug, data.token);
  const [branding, t] = await Promise.all([getEmailBranding(slug), getEmailT(slug, "emails")]);
  const totalLabel = formatCurrency(data.subtotalCents);
  const depositLabel = formatCurrency(data.depositCents);

  if (data.clientEmail) {
    try {
      await sendEmail({
        to: data.clientEmail,
        subject: t("quote.subject", { business: branding.businessName }),
        businessName: branding.businessName,
        react: (
          <QuoteReadyEmail
            businessName={branding.businessName}
            clientName={data.clientName}
            lines={data.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              amountLabel: formatCurrency(l.quantity * l.unitCents),
            }))}
            totalLabel={totalLabel}
            depositLabel={data.depositCents > 0 ? depositLabel : null}
            validUntilLabel={data.validUntilLabel}
            link={link}
            logoUrl={branding.logoUrl}
            brandColor={branding.brandColor}
            t={t}
          />
        ),
      });
    } catch (err) {
      console.error("[requests] quote email failed:", err);
    }
  }

  if (data.clientPhone) {
    try {
      await sendSms({
        to: data.clientPhone,
        tenantSlug: slug,
        clientId: data.clientId,
        messageType: "quote",
        body: t("quote.sms", { business: branding.businessName, total: totalLabel, deposit: depositLabel, link }),
      });
    } catch (err) {
      console.error("[requests] quote sms failed:", err);
    }
  }
}
