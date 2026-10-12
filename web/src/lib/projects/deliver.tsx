import { sendEmail } from "@/lib/email/send";
import { getEmailBranding } from "@/lib/email/branding";
import { sendSms } from "@/lib/sms/send";
import { getEmailT } from "@/lib/terms/email";
import { tenantPublicBaseUrl } from "@/lib/booking/public-url";
import { DesignReadyEmail } from "@/emails/design-ready";

/** Design approval pages live under the business's booking path, like quote pages. */
export function absoluteProjectUrl(slug: string, token: string): string {
  return `${tenantPublicBaseUrl(slug)}/book/${slug}/project/${token}`;
}

export type DesignRecipient = {
  clientId: string;
  email: string | null;
  phone: string | null;
  token: string;
};

/**
 * Tells the client their design is ready to review: an email when they have an
 * address, a text when they have a phone. Each channel is independent and best effort.
 */
export async function deliverDesign(slug: string, r: DesignRecipient): Promise<void> {
  const link = absoluteProjectUrl(slug, r.token);
  const [branding, t] = await Promise.all([getEmailBranding(slug), getEmailT(slug, "emails")]);

  if (r.email) {
    try {
      await sendEmail({
        to: r.email,
        subject: t("design.subject", { business: branding.salonName }),
        salonName: branding.salonName,
        react: (
          <DesignReadyEmail
            businessName={branding.salonName}
            t={t}
            link={link}
            logoUrl={branding.logoUrl}
            brandColor={branding.brandColor}
          />
        ),
      });
    } catch (err) {
      console.error("[projects] design email failed:", err);
    }
  }

  if (r.phone) {
    try {
      await sendSms({
        to: r.phone,
        tenantSlug: slug,
        clientId: r.clientId,
        messageType: "design",
        body: t("design.sms", { business: branding.salonName, link }),
      });
    } catch (err) {
      console.error("[projects] design sms failed:", err);
    }
  }
}
