"use server";
import { eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { BookingDepositPreview, previewBookingDepositForTenant, DepositChargeOutcome, chargeBookingDepositForTenant } from "@/lib/services/booking-deposits";

/**
 * Resolve the deposit for a prospective booking (for display on the confirm step).
 * Returns enabled=false when no services are selected.
 */
export async function previewBookingDeposit(
  serviceIds: string[],
  clientId: string | null,
  staffId: string | null = null,
): Promise<BookingDepositPreview> {
  const sessionClientId = await getBookingSession();
  const trustedClientId = clientId && clientId === sessionClientId ? clientId : null;
  const slug = await getTenantSlug();
  return previewBookingDepositForTenant(slug, serviceIds, trustedClientId, staffId);
}

/**
 * Collect the deposit recorded on an appointment (`appointments.deposit_cents`).
 * Idempotent — if a completed/pending deposit charge already exists for the
 * appointment it does nothing. Charges off-session via the saved card; if there's
 * no card yet, returns reason 'no_card' so the caller can retry after the client
 * saves one. Mirrors the cancellation/no-show charge pipeline (Connect + fees).
 */
export async function chargeBookingDeposit(
  appointmentId: string,
): Promise<DepositChargeOutcome> {
  const sessionClientId = await getBookingSession();
  const slug = await getTenantSlug();
  if (!sessionClientId) return { charged: false, reason: "failed" };
  const appt = await withTenantDb(slug, async (db, { appointments }) => {
    const [row] = await db
      .select({ clientId: appointments.clientId })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    return row ?? null;
  });
  if (!appt || appt.clientId !== sessionClientId) return { charged: false, reason: "failed" };
  return chargeBookingDepositForTenant(slug, appointmentId);
}
