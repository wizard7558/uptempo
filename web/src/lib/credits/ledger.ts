import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { TenantDb, TenantTransaction } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { pgErrorInfo } from "@/lib/db/pg-error";

/**
 * The credit ledger is the only way credits change. `client_packages.credits_remaining`
 * is a cache written by the ledger insert trigger; never write it from TypeScript.
 *
 * Every function takes a transaction. A failed statement (including INSUFFICIENT)
 * aborts a Postgres transaction, so callers must roll back and not keep using `tx`.
 */

export type LedgerReason =
  | "purchase"
  | "grant"
  | "redeem"
  | "refund"
  | "expire"
  | "late_cancel"
  | "adjust";

export class CreditError extends Error {
  readonly code: "INSUFFICIENT";
  constructor(code: "INSUFFICIENT") {
    super(code === "INSUFFICIENT" ? "There are no credits left on this pack." : code);
    this.name = "CreditError";
    this.code = code;
  }
}

export type CreditEntryInput = {
  clientPackageId: string;
  delta: number;
  reason: LedgerReason;
  appointmentId?: string | null;
  enrollmentId?: string | null;
  referenceId?: string | null;
  note?: string | null;
  createdBy?: string | null;
};

/** Appends one ledger row. Throws `CreditError("INSUFFICIENT")` if the balance would go below 0. */
export async function appendCredit(
  tx: TenantTransaction,
  tables: TenantTables,
  e: CreditEntryInput,
): Promise<{ id: string; balanceAfter: number }> {
  const { creditLedger } = tables;
  try {
    const [row] = await tx
      .insert(creditLedger)
      .values({
        clientPackageId: e.clientPackageId,
        delta: e.delta,
        reason: e.reason,
        appointmentId: e.appointmentId ?? null,
        enrollmentId: e.enrollmentId ?? null,
        referenceId: e.referenceId ?? null,
        note: e.note ?? null,
        createdBy: e.createdBy ?? null,
        // clock_timestamp() keeps "latest row" ordering exact even inside one transaction.
        createdAt: sql`clock_timestamp()`,
      })
      .returning({ id: creditLedger.id, balanceAfter: creditLedger.balanceAfter });
    return row;
  } catch (err) {
    if (pgErrorInfo(err).constraint === "credit_ledger_insufficient") {
      throw new CreditError("INSUFFICIENT");
    }
    throw err;
  }
}

/**
 * The package a client would spend from: active, has credits, not expired, and every
 * service is covered (an empty eligible list covers all services). Soonest expiry first.
 * The row is locked FOR UPDATE unless `lock: false` (a read-only "is there one?" check).
 */
export async function findRedeemablePackage(
  tx: Pick<TenantDb, "select">,
  tables: TenantTables,
  p: { clientId: string; serviceIds: string[]; at: Date; lock?: boolean },
): Promise<{ id: string; name: string; creditsRemaining: number } | null> {
  const { clientPackages } = tables;
  const query = tx
    .select({
      id: clientPackages.id,
      name: clientPackages.name,
      creditsRemaining: clientPackages.creditsRemaining,
    })
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.clientId, p.clientId),
        eq(clientPackages.status, "active"),
        gt(clientPackages.creditsRemaining, 0),
        or(isNull(clientPackages.expiresAt), gt(clientPackages.expiresAt, p.at)),
        or(
          sql`${clientPackages.eligibleServiceIds} = '[]'::jsonb`,
          sql`${clientPackages.eligibleServiceIds} @> ${JSON.stringify(p.serviceIds)}::jsonb`,
        ),
      ),
    )
    .orderBy(sql`${clientPackages.expiresAt} ASC NULLS LAST`, asc(clientPackages.createdAt))
    .limit(1);
  const [row] = p.lock === false ? await query : await query.for("update");
  return row ?? null;
}

/** Spends one credit on a booking and links it as `appointments.credit_entry_id`. Null when nothing qualifies. */
export async function redeemForAppointment(
  tx: TenantTransaction,
  tables: TenantTables,
  p: { clientId: string; serviceIds: string[]; appointmentId: string; at?: Date },
): Promise<string | null> {
  const pkg = await findRedeemablePackage(tx, tables, {
    clientId: p.clientId,
    serviceIds: p.serviceIds,
    at: p.at ?? new Date(),
  });
  if (!pkg) return null;
  const entry = await appendCredit(tx, tables, {
    clientPackageId: pkg.id,
    delta: -1,
    reason: "redeem",
    appointmentId: p.appointmentId,
    referenceId: `appt:${p.appointmentId}`,
  });
  await tx
    .update(tables.appointments)
    .set({ creditEntryId: entry.id })
    .where(eq(tables.appointments.id, p.appointmentId));
  return entry.id;
}

/** Same as `redeemForAppointment`, for a class seat (`class_enrollments.credit_entry_id`). */
export async function redeemForEnrollment(
  tx: TenantTransaction,
  tables: TenantTables,
  p: { clientId: string; serviceIds: string[]; enrollmentId: string; at?: Date },
): Promise<string | null> {
  const pkg = await findRedeemablePackage(tx, tables, {
    clientId: p.clientId,
    serviceIds: p.serviceIds,
    at: p.at ?? new Date(),
  });
  if (!pkg) return null;
  const entry = await appendCredit(tx, tables, {
    clientPackageId: pkg.id,
    delta: -1,
    reason: "redeem",
    enrollmentId: p.enrollmentId,
    referenceId: `enroll:${p.enrollmentId}`,
  });
  await tx
    .update(tables.classEnrollments)
    .set({ creditEntryId: entry.id })
    .where(eq(tables.classEnrollments.id, p.enrollmentId));
  return entry.id;
}

/**
 * Gives one credit back to the package a ledger row spent from. Safe to call twice:
 * the second call finds the earlier refund (`reference_id = "refund:" + ledgerId`) and does nothing.
 */
export async function refundEntry(
  tx: TenantTransaction,
  tables: TenantTables,
  ledgerId: string,
  reason: "refund",
  note?: string,
): Promise<void> {
  const { creditLedger, clientPackages } = tables;
  const [entry] = await tx
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.id, ledgerId))
    .limit(1);
  if (!entry) throw new Error(`Credit ledger entry ${ledgerId} not found`);
  if (entry.delta >= 0) throw new Error("Only a spent credit can be refunded");

  // Serialize on the package so two refunds of the same entry cannot both pass the check.
  await tx
    .select({ id: clientPackages.id })
    .from(clientPackages)
    .where(eq(clientPackages.id, entry.clientPackageId))
    .for("update");

  const referenceId = `refund:${ledgerId}`;
  const [existing] = await tx
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.clientPackageId, entry.clientPackageId),
        eq(creditLedger.reason, reason),
        eq(creditLedger.referenceId, referenceId),
      ),
    )
    .limit(1);
  if (existing) return;

  await appendCredit(tx, tables, {
    clientPackageId: entry.clientPackageId,
    delta: 1,
    reason,
    appointmentId: entry.appointmentId,
    enrollmentId: entry.enrollmentId,
    referenceId,
    note,
  });
}
