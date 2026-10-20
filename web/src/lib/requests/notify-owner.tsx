import { and, eq } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { memberships } from "@/lib/db/schema/memberships";
import { sendEmail } from "@/lib/email/send";
import { getEmailBranding } from "@/lib/email/branding";
import { getEmailT } from "@/lib/terms/email";
import { getBaseUrl } from "@/lib/utils";
import { RequestNewEmail } from "@/emails/request-new";

/** Emails the owner that a request arrived. No-op when the owner has no email. */
export async function notifyOwnerOfRequest(params: {
  slug: string;
  requestId: string;
  clientName: string;
}): Promise<void> {
  const { slug, requestId, clientName } = params;
  const [owner] = await publicDb
    .select({ email: user.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.tenantSlug, slug), eq(memberships.role, "owner")))
    .limit(1);
  if (!owner?.email) return;
  const [t, branding] = await Promise.all([getEmailT(slug, "emails"), getEmailBranding(slug)]);
  const subject = t("request.ownerSubject", { name: clientName });
  await sendEmail({
    to: owner.email,
    subject,
    businessName: branding.businessName,
    react: (
      <RequestNewEmail
        t={t}
        businessName={branding.businessName}
        heading={subject}
        body={t("request.ownerBody", { name: clientName })}
        cta={t("request.ownerCta")}
        url={`${getBaseUrl()}/requests/${requestId}`}
        logoUrl={branding.logoUrl}
        brandColor={branding.brandColor}
      />
    ),
  });
}
