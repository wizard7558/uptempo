import { getT } from "@/lib/terms/server";
import { verifyActionToken } from "@/lib/email/tokens";
import { loadAppointmentForTenant } from "@/lib/appointments/load";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { withTenantDb } from "@/lib/db/tenant";
import {
  getTenantBySlug,
  resolveTenantSlugForAppointment,
} from "@/lib/tenant/registry";
import { eq } from "drizzle-orm";
import {
  isWithinCancellationWindow,
  calculateFee,
  calculateAppointmentPrice,
} from "@/lib/services/policy-engine";
import { CancelForm } from "./cancel-form";

export default async function CancelPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getT("booking");
  const payload = verifyActionToken(token);

  if (!payload || payload.action !== "cancel") {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Link Expired</h1>
          <p className="text-[var(--ink-soft)]">
            {t("cancelPage.linkExpired")}
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

  if (appointment.status === "cancelled") {
    return (
      <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
        <div className="mx-auto max-w-md px-4 py-12 text-center">
          <h1 className="display text-4xl mb-4 text-[var(--ink)]">Already Cancelled</h1>
          <p className="text-[var(--ink-soft)]">
            This appointment has already been cancelled. No further action is
            needed.
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
            {t("cancelPage.loadError")}
          </p>
        </div>
      </div>
    );
  }

  // Get salon policy from tenant schema
  const policy = await withTenantDb(slug, async (db, { businessSettings }) => {
    const [p] = await db
      .select({
        timezone: businessSettings.timezone,
        cancellationWindowHours: businessSettings.cancellationWindowHours,
        cancellationFeePercent: businessSettings.cancellationFeePercent,
      })
      .from(businessSettings)
      .limit(1);
    return p;
  });

  // Get salon name from tenant registry (public schema)
  const tenant = await getTenantBySlug(slug);
  const salonName = tenant?.name ?? t("cancelPage.defaultName");

  const tz = policy?.timezone ?? "America/New_York";

  // Determine if this is a late cancellation
  const isLateCancellation = policy
    ? isWithinCancellationWindow(
        appointment.start,
        policy.cancellationWindowHours,
      )
    : false;

  // Calculate potential fee if late cancellation
  let potentialFeeCents = 0;
  if (isLateCancellation && policy) {
    const apptServices = await withTenantDb(slug, async (db, { appointmentServices, services }) => {
      return db
        .select({
          priceChargedCents: appointmentServices.priceChargedCents,
          priceCents: services.priceCents,
        })
        .from(appointmentServices)
        .innerJoin(services, eq(appointmentServices.serviceId, services.id))
        .where(eq(appointmentServices.appointmentId, appointment.id));
    });

    const totalPrice = calculateAppointmentPrice(apptServices);
    const fee = calculateFee(
      totalPrice,
      policy.cancellationFeePercent,
      "late_cancellation",
    );
    potentialFeeCents = fee.feeCents;
  }

  const apptDate = new TZDate(appointment.start, tz);
  const dateStr = format(apptDate, "EEEE, MMMM d, yyyy");
  const timeStr = format(apptDate, "h:mm a");
  const serviceNames = appointment.services.map((s) => s.serviceName);

  return (
    <div className="min-h-screen bg-[var(--ivory)] flex items-center justify-center">
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="display text-4xl mb-2 text-[var(--ink)]">Cancel Appointment</h1>
        <p className="text-[var(--ink-soft)] mb-6">
          Are you sure you want to cancel this appointment?
        </p>

        <div className="border border-[var(--line)] p-4 mb-6 space-y-2 text-sm">
          <div>
            <span className="font-medium text-[var(--ink-soft)]">Date:</span>{" "}
            {dateStr}
          </div>
          <div>
            <span className="font-medium text-[var(--ink-soft)]">Time:</span>{" "}
            {timeStr}
          </div>
          <div>
            <span className="font-medium text-[var(--ink-soft)]">
              Services:
            </span>{" "}
            {serviceNames.join(", ")}
          </div>
        </div>

        <CancelForm
          appointmentId={appointment.id}
          isLateCancellation={isLateCancellation}
          potentialFeeCents={potentialFeeCents}
          salonName={salonName}
        />
      </div>
    </div>
  );
}
