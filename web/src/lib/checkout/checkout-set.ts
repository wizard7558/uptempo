/**
 * The set of appointments one checkout pays for: a single appointment, or every
 * confirmed member of a group booking. Server-only.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { loadProjectLedger } from "@/lib/projects/ledger";
import { hasRedeemablePackage } from "@/lib/credits/appointment-credits";

export type CheckoutService = {
  serviceId: string;
  serviceName: string;
  priceChargedCents: number | null;
  priceCents: number | null;
};

export type CheckoutSet = {
  /** The appointment the charge row points at (the first confirmed member for a group). */
  anchorId: string;
  appointmentIds: string[];
  groupId: string | null;
  /** The client who pays: the group's payer, or the appointment's client. */
  payerClientId: string;
  /**
   * Line items of every appointment. In a group each name is prefixed
   * "{client or staff} · " (the client when members have different clients, else the staff member).
   */
  services: CheckoutService[];
  /** Deposits already collected (completed or pending) across all appointments. */
  depositPaidCents: number;
  /** The multi-session project the anchor appointment belongs to, if any. */
  project: {
    id: string;
    /** Deposit collected on the project and not yet applied to a service payment. */
    depositCreditCents: number;
    /** No later session is scheduled and this one reaches the planned session count. */
    isLastScheduled: boolean;
  } | null;
  /** Every appointment in the set was paid for with a credit (`credit_entry_id` set). */
  creditCovered: boolean;
  /** "Use a credit" can be offered: not covered, a single appointment, no deposit taken, a package fits. */
  creditEligible: boolean;
};

/**
 * The deposit to subtract from what the client owes now. Outside a project it is
 * the deposits already collected on the set. In a project no deposit applies
 * until the staff member marks the final session; then the whole unapplied
 * project credit does.
 */
export function resolveDepositToApply(
  set: Pick<CheckoutSet, "depositPaidCents" | "project">,
  finalProjectSession?: boolean,
): number {
  if (!set.project) return set.depositPaidCents;
  return finalProjectSession ? set.project.depositCreditCents : 0;
}

export type CheckoutSetError = "Appointment not found" | `Appointment is already ${string}`;

export type LoadCheckoutSetResult = { ok: true; set: CheckoutSet } | { ok: false; error: CheckoutSetError };

/** Loads what a checkout for `appointmentId` pays for. The appointment must be confirmed. */
export async function loadCheckoutSet(
  db: TenantDb,
  tables: TenantTables,
  appointmentId: string,
  /** `creditsEnabled`: the packages module is on, so `creditEligible` may be true. */
  opts: { creditsEnabled?: boolean } = {},
): Promise<LoadCheckoutSetResult> {
  const { appointments, appointmentServices, services, clients, staff, charges, bookingGroups } = tables;

  const [appt] = await db
    .select({
      id: appointments.id,
      status: appointments.status,
      clientId: appointments.clientId,
      groupId: appointments.bookingGroupId,
      projectId: appointments.projectId,
      during: appointments.during,
      creditEntryId: appointments.creditEntryId,
    })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  if (!appt) return { ok: false, error: "Appointment not found" };
  if (appt.status !== "confirmed") return { ok: false, error: `Appointment is already ${appt.status}` };

  let appointmentIds = [appt.id];
  let payerClientId = appt.clientId;
  let groupMode = false;
  let creditCovered = appt.creditEntryId !== null;
  if (appt.groupId) {
    const members = await db
      .select({ id: appointments.id, creditEntryId: appointments.creditEntryId })
      .from(appointments)
      .where(and(eq(appointments.bookingGroupId, appt.groupId), eq(appointments.status, "confirmed")))
      .orderBy(sql`lower(${appointments.during})`, asc(appointments.createdAt), asc(appointments.id));
    const [group] = await db
      .select({ clientId: bookingGroups.clientId })
      .from(bookingGroups)
      .where(eq(bookingGroups.id, appt.groupId))
      .limit(1);
    if (members.length > 0 && group) {
      appointmentIds = members.map((m) => m.id);
      payerClientId = group.clientId;
      groupMode = true;
      creditCovered = members.every((m) => m.creditEntryId !== null);
    }
  }

  const lines = await db
    .select({
      appointmentId: appointmentServices.appointmentId,
      serviceId: appointmentServices.serviceId,
      serviceName: services.name,
      priceChargedCents: appointmentServices.priceChargedCents,
      priceCents: services.priceCents,
      clientName: clients.name,
      clientId: appointments.clientId,
      staffName: staff.displayName,
    })
    .from(appointmentServices)
    .innerJoin(services, eq(appointmentServices.serviceId, services.id))
    .innerJoin(appointments, eq(appointmentServices.appointmentId, appointments.id))
    .innerJoin(clients, eq(appointments.clientId, clients.id))
    .innerJoin(staff, eq(appointments.staffId, staff.id))
    .where(inArray(appointmentServices.appointmentId, appointmentIds));

  const order = new Map(appointmentIds.map((id, i) => [id, i]));
  lines.sort((a, b) => (order.get(a.appointmentId) ?? 0) - (order.get(b.appointmentId) ?? 0));
  const manyClients = new Set(lines.map((l) => l.clientId)).size > 1;

  const deposits = await db
    .select({ amountCents: charges.amountCents, status: charges.status })
    .from(charges)
    .where(and(inArray(charges.appointmentId, appointmentIds), eq(charges.reason, "deposit")));
  const depositPaidCents = deposits
    .filter((c) => c.status === "completed" || c.status === "pending")
    .reduce((sum, c) => sum + c.amountCents, 0);

  let project: CheckoutSet["project"] = null;
  if (appt.projectId) {
    const { projects } = tables;
    const [row] = await db
      .select({ id: projects.id, estSessions: projects.estSessions, quotedTotalCents: projects.quotedTotalCents })
      .from(projects)
      .where(eq(projects.id, appt.projectId))
      .limit(1);
    if (row) {
      const ledger = await loadProjectLedger(db, tables, row.id, row.quotedTotalCents);
      const [{ later }] = await db
        .select({ later: sql<number>`count(*)::int` })
        .from(appointments)
        .where(
          and(
            eq(appointments.projectId, row.id),
            ne(appointments.id, appt.id),
            ne(appointments.status, "cancelled"),
            sql`lower(${appointments.during}) > ${appt.during.start.toISOString()}::timestamptz`,
          ),
        );
      const [{ done }] = await db
        .select({ done: sql<number>`count(*)::int` })
        .from(appointments)
        .where(and(eq(appointments.projectId, row.id), eq(appointments.status, "completed")));
      project = {
        id: row.id,
        depositCreditCents: Math.max(0, ledger.depositCreditCents),
        isLastScheduled: later === 0 && done + 1 >= row.estSessions,
      };
    }
  }

  const creditEligible =
    opts.creditsEnabled === true &&
    !creditCovered &&
    appointmentIds.length === 1 &&
    !appt.groupId &&
    depositPaidCents === 0 &&
    (await hasRedeemablePackage(db, tables, {
      clientId: appt.clientId,
      serviceIds: lines.map((l) => l.serviceId),
    }));

  return {
    ok: true,
    set: {
      anchorId: appointmentIds[0],
      appointmentIds,
      groupId: groupMode ? appt.groupId : null,
      payerClientId,
      services: lines.map((l) => ({
        serviceId: l.serviceId,
        serviceName: groupMode ? `${manyClients ? l.clientName : l.staffName} · ${l.serviceName}` : l.serviceName,
        priceChargedCents: l.priceChargedCents,
        priceCents: l.priceCents,
      })),
      depositPaidCents,
      project,
      creditCovered,
      creditEligible,
    },
  };
}
