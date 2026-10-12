import { and, eq, inArray } from "drizzle-orm";
import type { TenantDb, TenantTransaction } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import {
  appendCredit,
  findRedeemablePackage,
  redeemForAppointment,
} from "@/lib/credits/ledger";

/**
 * Credits on existing appointments: "Take a credit for this late cancel" and
 * "Use a credit" at checkout. Everything here spends through the credit ledger.
 */

/** A late-cancel credit can be taken on a cancelled or no-show visit that has no credit yet. */
export function canTakeLateCancelCredit(a: { status: string; creditEntryId: string | null }): boolean {
  return (a.status === "cancelled" || a.status === "no_show") && !a.creditEntryId;
}

/** The services an appointment is booked for (line items, else the legacy single service). */
export async function serviceIdsForAppointment(
  db: Pick<TenantDb, "select">,
  tables: TenantTables,
  appointmentId: string,
  legacyServiceId: string | null,
): Promise<string[]> {
  const rows = await db
    .select({ serviceId: tables.appointmentServices.serviceId })
    .from(tables.appointmentServices)
    .where(eq(tables.appointmentServices.appointmentId, appointmentId));
  const ids = rows.map((r) => r.serviceId);
  return ids.length > 0 ? ids : legacyServiceId ? [legacyServiceId] : [];
}

/** True when the client has a package that could pay for these services right now (no locks taken). */
export async function hasRedeemablePackage(
  db: Pick<TenantDb, "select">,
  tables: TenantTables,
  p: { clientId: string; serviceIds: string[] },
): Promise<boolean> {
  if (p.serviceIds.length === 0) return false;
  const pkg = await findRedeemablePackage(db, tables, { ...p, at: new Date(), lock: false });
  return pkg !== null;
}

export type AppointmentCreditResult =
  | { ok: true; ledgerId: string }
  | { ok: false; code: "NOT_FOUND" | "NOT_ELIGIBLE" | "NO_PACKAGE" };

/**
 * Takes one credit for a late cancel or no-show and links it to the appointment.
 * Locks the appointment row first, so two clicks cannot take two credits.
 */
export async function takeLateCancelCreditTx(
  tx: TenantTransaction,
  tables: TenantTables,
  p: { appointmentId: string; createdBy?: string | null },
): Promise<AppointmentCreditResult> {
  const { appointments } = tables;
  const [appt] = await tx
    .select({
      clientId: appointments.clientId,
      serviceId: appointments.serviceId,
      status: appointments.status,
      creditEntryId: appointments.creditEntryId,
    })
    .from(appointments)
    .where(eq(appointments.id, p.appointmentId))
    .limit(1)
    .for("update");
  if (!appt) return { ok: false, code: "NOT_FOUND" };
  if (!canTakeLateCancelCredit(appt)) return { ok: false, code: "NOT_ELIGIBLE" };

  const serviceIds = await serviceIdsForAppointment(tx, tables, p.appointmentId, appt.serviceId);
  const pkg = serviceIds.length
    ? await findRedeemablePackage(tx, tables, { clientId: appt.clientId, serviceIds, at: new Date() })
    : null;
  if (!pkg) return { ok: false, code: "NO_PACKAGE" };

  const entry = await appendCredit(tx, tables, {
    clientPackageId: pkg.id,
    delta: -1,
    reason: "late_cancel",
    appointmentId: p.appointmentId,
    referenceId: `late:${p.appointmentId}`,
    createdBy: p.createdBy ?? null,
  });
  await tx
    .update(appointments)
    .set({ creditEntryId: entry.id })
    .where(eq(appointments.id, p.appointmentId));
  return { ok: true, ledgerId: entry.id };
}

/**
 * "Use a credit" at checkout: spends one credit on a confirmed visit that has none.
 * Only a single-appointment checkout can be covered; a group booking pays as before.
 */
export async function applyCreditAtCheckoutTx(
  tx: TenantTransaction,
  tables: TenantTables,
  p: { appointmentId: string },
): Promise<AppointmentCreditResult> {
  const { appointments } = tables;
  const [appt] = await tx
    .select({
      clientId: appointments.clientId,
      serviceId: appointments.serviceId,
      status: appointments.status,
      creditEntryId: appointments.creditEntryId,
      groupId: appointments.bookingGroupId,
    })
    .from(appointments)
    .where(eq(appointments.id, p.appointmentId))
    .limit(1)
    .for("update");
  if (!appt) return { ok: false, code: "NOT_FOUND" };
  if (appt.status !== "confirmed" || appt.creditEntryId || appt.groupId) {
    return { ok: false, code: "NOT_ELIGIBLE" };
  }
  // A deposit already collected would have nothing to be credited against; staff take payment as usual.
  const [deposit] = await tx
    .select({ id: tables.charges.id })
    .from(tables.charges)
    .where(
      and(
        eq(tables.charges.appointmentId, p.appointmentId),
        eq(tables.charges.reason, "deposit"),
        inArray(tables.charges.status, ["completed", "pending"]),
      ),
    )
    .limit(1);
  if (deposit) return { ok: false, code: "NOT_ELIGIBLE" };
  const serviceIds = await serviceIdsForAppointment(tx, tables, p.appointmentId, appt.serviceId);
  if (serviceIds.length === 0) return { ok: false, code: "NO_PACKAGE" };
  const ledgerId = await redeemForAppointment(tx, tables, {
    clientId: appt.clientId,
    serviceIds,
    appointmentId: p.appointmentId,
  });
  return ledgerId ? { ok: true, ledgerId } : { ok: false, code: "NO_PACKAGE" };
}
