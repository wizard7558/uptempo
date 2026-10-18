import { getT } from "@/lib/terms/server";
import { redirect } from "next/navigation";
import { verifyActionToken } from "@/lib/email/tokens";
import { loadAppointmentForTenant } from "@/lib/appointments/load";
import { resolveTenantSlugForAppointment } from "@/lib/tenant/registry";

export default async function ReschedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getT("booking");
  const payload = verifyActionToken(token);

  if (!payload || payload.action !== "reschedule") {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Link Expired</h1>
          <p className="text-[var(--ink-soft)]">
            {t("reschedulePage.linkExpired")}
          </p>
        </div>
      </div>
    );
  }

  // The tenant comes from the signed link's appointment id, never from the
  // request, and the unguarded loader is used because the client has no staff
  // session.
  const slug = await resolveTenantSlugForAppointment(payload.appointmentId);
  const appointment = slug
    ? await loadAppointmentForTenant(slug, payload.appointmentId)
    : null;

  if (!appointment) {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Appointment Not Found</h1>
          <p className="text-[var(--ink-soft)]">
            We could not find this appointment. It may have already been
            cancelled.
          </p>
        </div>
      </div>
    );
  }

  if (!slug) {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Something went wrong</h1>
          <p className="text-[var(--ink-soft)]">
            {t("reschedulePage.openError")}
          </p>
        </div>
      </div>
    );
  }

  // Build redirect URL with pre-filled stylist and services
  const serviceIds = appointment.services
    .map((s) => s.serviceId)
    .join(",");
  const rescheduleUrl = `/book/${slug}?reschedule=${appointment.id}&stylist=${appointment.staffId}&services=${serviceIds}`;

  redirect(rescheduleUrl);
}
