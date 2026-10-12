/**
 * Writes the result of a checkout: the stored-value ledger entry, ONE
 * service_payment charge and the completed status of every appointment in the
 * set, in a single transaction. Server-only.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { appendStoredValueLedger } from "@/lib/services/stored-value-ledger";
import { linkGiftCardCharge } from "@/lib/gift-cards/service";
import type { CheckoutSet } from "./checkout-set";

type SetIds = Pick<CheckoutSet, "appointmentIds" | "groupId">;

/** True when a completed service payment already covers any appointment in the set. */
export async function hasCompletedServicePayment(
  db: Pick<TenantDb, "select">,
  { charges }: TenantTables,
  set: SetIds,
): Promise<boolean> {
  const covers: SQL | undefined = set.groupId
    ? or(inArray(charges.appointmentId, set.appointmentIds), eq(charges.bookingGroupId, set.groupId))
    : inArray(charges.appointmentId, set.appointmentIds);
  const rows = await db
    .select({ id: charges.id })
    .from(charges)
    .where(and(covers, eq(charges.reason, "service_payment"), eq(charges.status, "completed")))
    .limit(1);
  return rows.length > 0;
}

export type RecordServicePaymentParams = {
  set: Pick<CheckoutSet, "anchorId" | "appointmentIds" | "groupId" | "payerClientId">;
  /** Service total plus tip. */
  amountCents: number;
  tipCents: number;
  status: "completed" | "failed";
  stripePaymentIntentId: string | null;
  failureReason: string | null;
  platformFeeCents: number | null;
  connectAccountId: string | null;
  /** Part paid from stored value; a ledger debit is written when above 0. */
  storedValueCents: number;
  /** Deposit credited against this payment; omitted means 0. Written on every service_payment. */
  depositAppliedCents?: number;
  /** Gift card already debited for this checkout. Linked to the charge in this transaction. */
  giftCardId?: string | null;
  giftCardCents?: number | null;
  giftCardTxId?: string | null;
  ledgerNote: string;
};

export type RecordServicePaymentResult =
  | { ok: true; chargeId: string }
  | { ok: false; error: "Already checked out" };

export async function recordServicePayment(
  db: TenantDb,
  tables: TenantTables,
  p: RecordServicePaymentParams,
): Promise<RecordServicePaymentResult> {
  const { appointments, charges } = tables;
  return db.transaction(async (tx) => {
    // Lock the anchor so two checkouts of the same set run one after the other.
    await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.id, p.set.anchorId))
      .for("update");
    if (await hasCompletedServicePayment(tx, tables, p.set)) {
      return { ok: false as const, error: "Already checked out" as const };
    }

    if (p.storedValueCents > 0) {
      await appendStoredValueLedger(tx, tables, {
        clientId: p.set.payerClientId,
        type: "service_debit",
        amountCents: -p.storedValueCents,
        referenceId: p.set.anchorId,
        note: p.ledgerNote,
      });
    }

    const [inserted] = await tx
      .insert(charges)
      .values({
        appointmentId: p.set.anchorId,
        clientId: p.set.payerClientId,
        bookingGroupId: p.set.groupId,
        amountCents: p.amountCents,
        tipCents: p.tipCents > 0 ? p.tipCents : null,
        reason: "service_payment",
        status: p.status,
        stripePaymentIntentId: p.stripePaymentIntentId,
        failureReason: p.failureReason,
        platformFeeCents: p.platformFeeCents,
        connectAccountId: p.connectAccountId,
        storedValueCents: p.storedValueCents > 0 ? p.storedValueCents : null,
        depositAppliedCents: p.depositAppliedCents ?? 0,
        giftCardId: p.giftCardId ?? null,
        giftCardCents: p.giftCardCents && p.giftCardCents > 0 ? p.giftCardCents : null,
      })
      .returning({ id: charges.id });

    if (p.giftCardTxId) {
      await linkGiftCardCharge(tx, tables, { txId: p.giftCardTxId, chargeId: inserted.id });
    }

    await tx
      .update(appointments)
      .set({ status: "completed", updatedAt: new Date() })
      .where(inArray(appointments.id, p.set.appointmentIds));

    return { ok: true as const, chargeId: inserted.id };
  });
}
