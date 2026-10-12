"use server";

import { requireStaff } from "@/lib/auth/rbac";
import { getEmailT } from "@/lib/terms/email";
import { getEmailBranding } from "@/lib/email/branding";
import { render } from "@react-email/render";
import { FormRequestEmail } from "@/emails/form-request";
import { AftercareEmail } from "@/emails/aftercare";

async function previewContext() {
  const { tenantSlug: slug } = await requireStaff();
  const [t, branding] = await Promise.all([
    getEmailT(slug, "emails"),
    getEmailBranding(slug),
  ]);
  return { t, branding };
}

export async function renderFormRequestPreview(data: {
  formName: string;
  formDescription?: string | null;
}) {
  await requireStaff();
  const { t, branding } = await previewContext();
  const html = await render(
    FormRequestEmail({
      t,
      salonName: branding.salonName,
      clientName: "Jane",
      formName: data.formName,
      formDescription: data.formDescription,
      formUrl: "#",
      logoUrl: branding.logoUrl,
      brandColor: branding.brandColor,
    }),
  );
  return { html };
}

export async function renderAftercarePreview(data: {
  templates: Array<{
    name: string;
    content: string;
    productRecommendations: string | null;
  }>;
}) {
  await requireStaff();
  const { t, branding } = await previewContext();
  const html = await render(
    AftercareEmail({
      t,
      salonName: branding.salonName,
      clientName: "Jane",
      templates: data.templates,
      logoUrl: branding.logoUrl,
      brandColor: branding.brandColor,
    }),
  );
  return { html };
}
