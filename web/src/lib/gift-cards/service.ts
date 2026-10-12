import { and, eq, sql } from "drizzle-orm";
import { withTenantDb, type TenantDb, type TenantTransaction } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { sendGiftCardEmail } from "./email";
import {
  formatGiftCardCode,
  generateGiftCardCode,
  giftCardLast4,
  hashGiftCardCode,
  normalizeGiftCardCode,
} from "./code";

type Db = TenantDb | TenantTransaction;

export class GiftCardBalanceError extends Error {
  constructor() {
    super("Gift card balance changed");
    this.name = "GiftCardBalanceError";
  }
}

export class GiftCardRangeError extends Error {
  constructor() {
    super("Gift card balance out of range");
    this.name = "GiftCardRangeError";
  }
}

export class GiftCardInactiveError extends Error {
  constructor() {
    super("Gift card is cancelled");
    this.name = "GiftCardInactiveError";
  }
}

export type GiftCardSource = "online" | "in_person" | "comp" | "replacement";

export type IssueGiftCardInput = {
  amountCents: number;
  source: GiftCardSource;
  purchaserClientId?: string | null;
  purchaserName?: string | null;
  purchaserEmail?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  message?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  platformFeeCents?: number;
  createdBy?: string | null;
};

const MAX_CENTS = 100_000;

/**
 * Inserts the card and its `issue` row. Retries a code-hash collision inside
 * a savepoint so one collision does not abort the caller's transaction.
 * The plaintext code is returned to the caller and is not written anywhere else.
 */
export async function issueGiftCard(
  tx: Db,
  tables: TenantTables,
  input: IssueGiftCardInput,
): Promise<{ id: string; code: string; last4: string }> {
  const { giftCards, giftCardTransactions } = tables;
  const message = input.message?.slice(0, 200) ?? null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateGiftCardCode();
    const last4 = giftCardLast4(code);
    await tx.execute(sql.raw("SAVEPOINT gift_card_issue"));
    try {
      const [card] = await tx
        .insert(giftCards)
        .values({
          codeHash: hashGiftCardCode(code),
          last4,
          initialCents: input.amountCents,
          balanceCents: input.amountCents,
          source: input.source,
          purchaserClientId: input.purchaserClientId ?? null,
          purchaserName: input.purchaserName ?? null,
          purchaserEmail: input.purchaserEmail ?? null,
          recipientName: input.recipientName ?? null,
          recipientEmail: input.recipientEmail ?? null,
          message,
          stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
          stripePaymentIntentId: input.stripePaymentIntentId ?? null,
          platformFeeCents: input.platformFeeCents ?? 0,
          createdBy: input.createdBy ?? null,
        })
        .returning({ id: giftCards.id });
      await tx.insert(giftCardTransactions).values({
        giftCardId: card.id,
        deltaCents: input.amountCents,
        balanceAfterCents: input.amountCents,
        reason: "issue",
        createdBy: input.createdBy ?? null,
      });
      await tx.execute(sql.raw("RELEASE SAVEPOINT gift_card_issue"));
      return { id: card.id, code, last4 };
    } catch (err) {
      await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT gift_card_issue"));
      const info = pgErrorInfo(err);
      lastError = err;
      if (info.code === "23505" && info.constraint === "gift_cards_code_hash_unique") continue;
      throw err;
    }
  }
  throw lastError;
}

export async function findGiftCardByCode(
  db: Db,
  tables: TenantTables,
  raw: string,
): Promise<{ id: string; last4: string; balanceCents: number; status: string } | null> {
  const normalized = normalizeGiftCardCode(raw);
  if (!normalized) return null;
  const { giftCards } = tables;
  const [row] = await db
    .select({
      id: giftCards.id,
      last4: giftCards.last4,
      balanceCents: giftCards.balanceCents,
      status: giftCards.status,
    })
    .from(giftCards)
    .where(eq(giftCards.codeHash, hashGiftCardCode(normalized)))
    .limit(1);
  return row ?? null;
}

/** Conditional debit. Zero rows means the balance or status changed, so nothing is written. */
export async function debitGiftCard(
  tx: Db,
  tables: TenantTables,
  input: { giftCardId: string; cents: number; appointmentId: string | null; createdBy: string | null },
): Promise<{ txId: string; balanceAfter: number }> {
  const { giftCards, giftCardTransactions } = tables;
  const [updated] = await tx
    .update(giftCards)
    .set({
      balanceCents: sql`${giftCards.balanceCents} - ${input.cents}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(giftCards.id, input.giftCardId),
        eq(giftCards.status, "active"),
        sql`${giftCards.balanceCents} >= ${input.cents}`,
      ),
    )
    .returning({ balanceCents: giftCards.balanceCents });
  if (!updated) throw new GiftCardBalanceError();
  const [row] = await tx
    .insert(giftCardTransactions)
    .values({
      giftCardId: input.giftCardId,
      appointmentId: input.appointmentId,
      deltaCents: -input.cents,
      balanceAfterCents: updated.balanceCents,
      reason: "redeem",
      createdBy: input.createdBy,
    })
    .returning({ id: giftCardTransactions.id });
  return { txId: row.id, balanceAfter: updated.balanceCents };
}

export async function reverseGiftCardDebit(
  tx: Db,
  tables: TenantTables,
  input: { txId: string; note: string },
): Promise<{ balanceAfter: number }> {
  const { giftCards, giftCardTransactions } = tables;
  const [redeem] = await tx
    .select({
      giftCardId: giftCardTransactions.giftCardId,
      deltaCents: giftCardTransactions.deltaCents,
      appointmentId: giftCardTransactions.appointmentId,
    })
    .from(giftCardTransactions)
    .where(eq(giftCardTransactions.id, input.txId))
    .limit(1);
  if (!redeem || redeem.deltaCents >= 0) throw new GiftCardBalanceError();
  const cents = -redeem.deltaCents;
  const [updated] = await tx
    .update(giftCards)
    .set({
      balanceCents: sql`${giftCards.balanceCents} + ${cents}`,
      updatedAt: new Date(),
    })
    .where(eq(giftCards.id, redeem.giftCardId))
    .returning({ balanceCents: giftCards.balanceCents });
  if (!updated) throw new GiftCardBalanceError();
  await tx.insert(giftCardTransactions).values({
    giftCardId: redeem.giftCardId,
    appointmentId: redeem.appointmentId,
    deltaCents: cents,
    balanceAfterCents: updated.balanceCents,
    reason: "reversal",
    note: input.note,
  });
  return { balanceAfter: updated.balanceCents };
}

export async function linkGiftCardCharge(
  tx: Db,
  tables: TenantTables,
  input: { txId: string; chargeId: string },
): Promise<void> {
  await tx
    .update(tables.giftCardTransactions)
    .set({ chargeId: input.chargeId })
    .where(eq(tables.giftCardTransactions.id, input.txId));
}

export async function adjustGiftCard(
  tx: Db,
  tables: TenantTables,
  input: { id: string; deltaCents: number; note: string; createdBy: string | null },
): Promise<{ balanceAfter: number }> {
  const { giftCards, giftCardTransactions } = tables;
  const [updated] = await tx
    .update(giftCards)
    .set({
      balanceCents: sql`${giftCards.balanceCents} + ${input.deltaCents}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(giftCards.id, input.id),
        eq(giftCards.status, "active"),
        sql`${giftCards.balanceCents} + ${input.deltaCents} BETWEEN 0 AND ${MAX_CENTS}`,
        sql`${input.deltaCents} <> 0`,
      ),
    )
    .returning({ balanceCents: giftCards.balanceCents });
  if (!updated) throw new GiftCardRangeError();
  await tx.insert(giftCardTransactions).values({
    giftCardId: input.id,
    deltaCents: input.deltaCents,
    balanceAfterCents: updated.balanceCents,
    reason: "adjustment",
    note: input.note,
    createdBy: input.createdBy,
  });
  return { balanceAfter: updated.balanceCents };
}

export async function voidGiftCard(
  tx: Db,
  tables: TenantTables,
  input: { id: string; note: string; createdBy: string | null },
): Promise<void> {
  const { giftCards, giftCardTransactions } = tables;
  const [card] = await tx
    .select({ balanceCents: giftCards.balanceCents, status: giftCards.status })
    .from(giftCards)
    .where(eq(giftCards.id, input.id))
    .for("update");
  if (!card || card.status !== "active") throw new GiftCardInactiveError();
  if (card.balanceCents > 0) {
    await tx.insert(giftCardTransactions).values({
      giftCardId: input.id,
      deltaCents: -card.balanceCents,
      balanceAfterCents: 0,
      reason: "void",
      note: input.note,
      createdBy: input.createdBy,
    });
  }
  await tx
    .update(giftCards)
    .set({ status: "void", balanceCents: 0, updatedAt: new Date() })
    .where(eq(giftCards.id, input.id));
}

export function formatIssuedCode(code: string): string {
  return formatGiftCardCode(code);
}

/**
 * Voids the old card and issues a new one with the same balance. The old code
 * cannot be emailed again because it was never stored. The new code is emailed
 * after the transaction commits.
 */
export async function replaceGiftCard(
  slug: string,
  input: { id: string; createdBy: string | null },
): Promise<{ id: string; code: string; last4: string; emailed: boolean }> {
  const issued = await withTenantDb(slug, async (db, tables) => {
    return db.transaction(async (tx) => {
      const { giftCards } = tables;
      const [card] = await tx
        .select()
        .from(giftCards)
        .where(eq(giftCards.id, input.id))
        .for("update");
      if (!card || card.status !== "active") throw new GiftCardInactiveError();
      if (card.balanceCents < 1) throw new GiftCardRangeError();
      await voidGiftCard(tx, tables, {
        id: card.id,
        note: "Replaced",
        createdBy: input.createdBy,
      });
      const next = await issueGiftCard(tx, tables, {
        amountCents: card.balanceCents,
        source: "replacement",
        purchaserClientId: card.purchaserClientId,
        purchaserName: card.purchaserName,
        purchaserEmail: card.purchaserEmail,
        recipientName: card.recipientName,
        recipientEmail: card.recipientEmail,
        message: card.message,
        createdBy: input.createdBy,
      });
      await tx
        .update(giftCards)
        .set({ replacedById: next.id, updatedAt: new Date() })
        .where(eq(giftCards.id, card.id));
      return {
        ...next,
        amountCents: card.balanceCents,
        recipientEmail: card.recipientEmail,
        recipientName: card.recipientName,
        purchaserName: card.purchaserName,
        message: card.message,
      };
    });
  });

  let emailed = false;
  if (issued.recipientEmail) {
    emailed = await sendGiftCardEmail(slug, {
      giftCardId: issued.id,
      to: issued.recipientEmail,
      recipientName: issued.recipientName,
      purchaserName: issued.purchaserName,
      amountCents: issued.amountCents,
      code: issued.code,
      message: issued.message,
    });
  }
  return { id: issued.id, code: issued.code, last4: issued.last4, emailed };
}
