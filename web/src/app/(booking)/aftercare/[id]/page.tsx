import { getT } from "@/lib/terms/server";
import { getEmailT } from "@/lib/terms/email";
import { render } from "@react-email/render";
import { verifyActionToken } from "@/lib/email/tokens";
import { resolveTenantSlugForAppointment } from "@/lib/tenant/registry";
import { withTenantDb } from "@/lib/db/tenant";
import { getAftercareTemplatesForTenantServices } from "@/lib/aftercare/for-tenant";
import { AftercareEmail } from "@/emails/aftercare";
import { getEmailBranding } from "@/lib/email/branding";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AftercarePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id: appointmentId } = await params;
  const { token } = await searchParams;
  const t = await getT("booking");

  if (!token) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[var(--ink-soft)]">
        {t("aftercarePage.missingToken")}
      </div>
    );
  }

  const payload = verifyActionToken(token);
  if (
    !payload ||
    payload.action !== "aftercare" ||
    payload.appointmentId !== appointmentId
  ) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[var(--ink-soft)]">
        {t("aftercarePage.invalidLink")}
      </div>
    );
  }

  const slug = await resolveTenantSlugForAppointment(appointmentId);
  if (!slug) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[var(--ink-soft)]">
        Appointment not found.
      </div>
    );
  }

  const row = await withTenantDb(slug, async (db, tables) => {
    const { appointments, appointmentServices, clients } = tables;
    const [appt] = await db
      .select({
        clientId: appointments.clientId,
      })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    if (!appt) return null;
    const [client] = await db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.id, appt.clientId))
      .limit(1);
    const svcRows = await db
      .select({ serviceId: appointmentServices.serviceId })
      .from(appointmentServices)
      .where(eq(appointmentServices.appointmentId, appointmentId));
    return {
      clientName: client?.name ?? "there",
      serviceIds: svcRows.map((r) => r.serviceId),
    };
  });

  if (!row) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[var(--ink-soft)]">
        Appointment not found.
      </div>
    );
  }

  const templates = await getAftercareTemplatesForTenantServices(
    slug,
    row.serviceIds,
  );

  if (templates.length === 0) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center text-[var(--ink-soft)]">
        No aftercare instructions are on file for this visit.
      </div>
    );
  }

  const [emailT, branding] = await Promise.all([
    getEmailT(slug, "emails"),
    getEmailBranding(slug),
  ]);

  const html = await render(
    AftercareEmail({
      t: emailT,
      salonName: branding.salonName,
      clientName: row.clientName,
      templates,
      logoUrl: branding.logoUrl,
      brandColor: branding.brandColor,
    }),
  );

  return (
    <div className="mx-auto max-w-2xl border border-[var(--line)] bg-[var(--ivory-raised)] p-4 sm:p-8">
      <div
        className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
