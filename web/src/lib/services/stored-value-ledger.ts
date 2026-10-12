import { eq, desc, and } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";

/** Drizzle transaction handle from `db.transaction(...)` */
type TenantTransaction = Parameters<
  Parameters<TenantDb["transaction"]>[0]
>[0];

type TenantDbOrTx = TenantDb | TenantTransaction;
import type { TenantTables } from "@/lib/db/tenant-schema";

export const STORED_VALUE_TRANSACTION_TYPES = [
  "subscription_credit",
  "topup_credit",
  "admin_credit",
  "service_debit",
  "product_debit",
  "refund_credit",
  "admin_debit",
  "expiry_debit",
  "transfer_out",
  "transfer_in",
] as const;

export type StoredValueTransactionType =
  (typeof STORED_VALUE_TRANSACTION_TYPES)[number];

export interface AppendLedgerParams {
  clientId: string;
  type: StoredValueTransactionType;
  /** Positive increases balance, negative decreases */
  amountCents: number;
  referenceId?: string | null;
  counterpartyClientId?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

/**
 * Read current balance without locking (use inside transactions with separate lock if needed).
 */
export async function getStoredValueBalanceCents(
  db: TenantDbOrTx,
  tables: TenantTables,
  clientId: string,
): Promise<number> {
  const { storedValueBalances } = tables;
  const [row] = await db
    .select({ balanceCents: storedValueBalances.balanceCents })
    .from(storedValueBalances)
    .where(eq(storedValueBalances.clientId, clientId))
    .limit(1);
  return row?.balanceCents ?? 0;
}

/**
 * Append a ledger entry and update materialized balance. Must run inside db.transaction.
 */
export async function appendStoredValueLedger(
  tx: TenantDbOrTx,
  tables: TenantTables,
  params: AppendLedgerParams,
): Promise<{ newBalanceCents: number; transactionId: string }> {
  const { storedValueBalances, storedValueTransactions } = tables;
  const { clientId, type, amountCents } = params;

  const [existing] = await tx
    .select()
    .from(storedValueBalances)
    .where(eq(storedValueBalances.clientId, clientId))
    .for("update");

  const prev = existing?.balanceCents ?? 0;
  const next = prev + amountCents;
  if (next < 0) {
    throw new Error("Insufficient stored value balance");
  }

  const now = new Date();
  if (existing) {
    await tx
      .update(storedValueBalances)
      .set({ balanceCents: next, updatedAt: now })
      .where(eq(storedValueBalances.clientId, clientId));
  } else {
    await tx.insert(storedValueBalances).values({
      clientId,
      balanceCents: next,
      updatedAt: now,
    });
  }

  const [inserted] = await tx
    .insert(storedValueTransactions)
    .values({
      clientId,
      type,
      amountCents,
      runningBalanceCents: next,
      referenceId: params.referenceId ?? null,
      counterpartyClientId: params.counterpartyClientId ?? null,
      note: params.note ?? null,
      createdBy: params.createdBy ?? null,
    })
    .returning({ id: storedValueTransactions.id });

  return { newBalanceCents: next, transactionId: inserted.id };
}

/**
 * Idempotent credit: if a transaction with the same reference_id and type exists, skip.
 */
export async function creditStoredValueIdempotent(
  tx: TenantDbOrTx,
  tables: TenantTables,
  params: AppendLedgerParams & { referenceId: string },
): Promise<{ credited: boolean; newBalanceCents: number }> {
  const { storedValueTransactions } = tables;
  const [dup] = await tx
    .select({ id: storedValueTransactions.id })
    .from(storedValueTransactions)
    .where(
      and(
        eq(storedValueTransactions.referenceId, params.referenceId),
        eq(storedValueTransactions.type, params.type),
      ),
    )
    .limit(1);

  if (dup) {
    const bal = await getStoredValueBalanceInTx(tx, tables, params.clientId);
    return { credited: false, newBalanceCents: bal };
  }

  const { newBalanceCents } = await appendStoredValueLedger(tx, tables, params);
  return { credited: true, newBalanceCents };
}

async function getStoredValueBalanceInTx(
  tx: TenantDbOrTx,
  tables: TenantTables,
  clientId: string,
): Promise<number> {
  const { storedValueBalances } = tables;
  const [row] = await tx
    .select({ balanceCents: storedValueBalances.balanceCents })
    .from(storedValueBalances)
    .where(eq(storedValueBalances.clientId, clientId))
    .limit(1);
  return row?.balanceCents ?? 0;
}

/**
 * Transfer funds from one client to another (paired ledger rows).
 */
export async function transferStoredValueBetweenClients(
  tx: TenantDbOrTx,
  tables: TenantTables,
  params: {
    fromClientId: string;
    toClientId: string;
    amountCents: number;
    createdBy?: string | null;
  },
): Promise<{ outId: string; inId: string }> {
  if (params.amountCents <= 0) {
    throw new Error("Transfer amount must be positive");
  }
  if (params.fromClientId === params.toClientId) {
    throw new Error("Cannot transfer to the same client");
  }

  const out = await appendStoredValueLedger(tx, tables, {
    clientId: params.fromClientId,
    type: "transfer_out",
    amountCents: -params.amountCents,
    counterpartyClientId: params.toClientId,
    note: "Transfer to another client",
    createdBy: params.createdBy ?? null,
  });

  const inn = await appendStoredValueLedger(tx, tables, {
    clientId: params.toClientId,
    type: "transfer_in",
    amountCents: params.amountCents,
    counterpartyClientId: params.fromClientId,
    referenceId: out.transactionId,
    note: "Transfer from another client",
    createdBy: params.createdBy ?? null,
  });

  await tx
    .update(tables.storedValueTransactions)
    .set({ referenceId: inn.transactionId })
    .where(eq(tables.storedValueTransactions.id, out.transactionId));

  return { outId: out.transactionId, inId: inn.transactionId };
}

export async function listStoredValueTransactions(
  db: TenantDbOrTx,
  tables: TenantTables,
  clientId: string,
  limit = 50,
) {
  const { storedValueTransactions } = tables;
  return db
    .select()
    .from(storedValueTransactions)
    .where(eq(storedValueTransactions.clientId, clientId))
    .orderBy(desc(storedValueTransactions.createdAt))
    .limit(limit);
}
