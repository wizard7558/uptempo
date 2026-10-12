"use server";

import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { withTenantDb } from "@/lib/db/tenant";
import { assertModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";
import {
  adjustGiftCard,
  findGiftCardByCode,
  formatIssuedCode,
  GiftCardInactiveError,
  GiftCardRangeError,
  issueGiftCard,
  replaceGiftCard,
  voidGiftCard,
} from "@/lib/gift-cards/service";
import { sendGiftCardEmail } from "@/lib/gift-cards/email";

const TEN_MIN_MS = 10 * 60 * 1000;

type Failure = { success: false; error: string };

async function adminGuard() {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  await assertModule(slug, "gift_cards");
  return { slug, userId: auth.userId, te: await getT("errors", slug) };
}

async function staffGuard() {
  const auth = await requireRole("owner", "admin", "provider", "assistant");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  await assertModule(slug, "gift_cards");
  return { slug, userId: auth.userId, te: await getT("errors", slug) };
}

const sellSchema = z.object({
  amountCents: z.number().int().min(1000).max(100_000),
  recipientName: z.string().trim().max(80).optional(),
  recipientEmail: z.union([z.literal(""), z.string().trim().email().max(200)]).optional(),
  paid: z.enum(["in_person", "comp"]),
});

export type GiftCardRow = {
  id: string;
  last4: string;
  balanceCents: number;
  status: string;
  source: string;
  recipientName: string | null;
  recipientEmail: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export async function listGiftCards(input: { q?: string } = {}): Promise<{
  rows: GiftCardRow[];
  outstandingCents: number;
}> {
  await requireStaff();
  const { slug } = await adminGuard();
  const q = input.q?.trim().replace(/[%_]/g, "") ?? "";
  return withTenantDb(slug, async (db, tables) => {
    const { giftCards } = tables;
    const filter = q
      ? or(
          ilike(giftCards.last4, `%${q}%`),
          ilike(giftCards.recipientName, `%${q}%`),
          ilike(giftCards.recipientEmail, `%${q}%`),
        )
      : undefined;
    const rows = await db
      .select({
        id: giftCards.id,
        last4: giftCards.last4,
        balanceCents: giftCards.balanceCents,
        status: giftCards.status,
        source: giftCards.source,
        recipientName: giftCards.recipientName,
        recipientEmail: giftCards.recipientEmail,
        deliveredAt: giftCards.deliveredAt,
        createdAt: giftCards.createdAt,
      })
      .from(giftCards)
      .where(filter)
      .orderBy(desc(giftCards.createdAt))
      .limit(200);
    const [sum] = await db
      .select({
        outstanding: sql<number>`coalesce(sum(${giftCards.balanceCents}), 0)::int`,
      })
      .from(giftCards)
      .where(eq(giftCards.status, "active"));
    return {
      outstandingCents: sum?.outstanding ?? 0,
      rows: rows.map((row) => ({
        ...row,
        deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });
}

export type GiftCardHistoryRow = {
  id: string;
  deltaCents: number;
  balanceAfterCents: number;
  reason: string;
  note: string | null;
  createdAt: string;
};

export async function getGiftCardHistory(
  id: string,
): Promise<{ rows: GiftCardHistoryRow[] } | Failure> {
  await requireStaff();
  const { slug, te } = await adminGuard();
  if (!z.string().uuid().safeParse(id).success) {
    return { success: false, error: te("giftCards.notFound") };
  }
  return withTenantDb(slug, async (db, tables) => {
    const rows = await db
      .select({
        id: tables.giftCardTransactions.id,
        deltaCents: tables.giftCardTransactions.deltaCents,
        balanceAfterCents: tables.giftCardTransactions.balanceAfterCents,
        reason: tables.giftCardTransactions.reason,
        note: tables.giftCardTransactions.note,
        createdAt: tables.giftCardTransactions.createdAt,
      })
      .from(tables.giftCardTransactions)
      .where(eq(tables.giftCardTransactions.giftCardId, id))
      .orderBy(tables.giftCardTransactions.createdAt);
    return {
      rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    };
  });
}

export async function sellGiftCardInPerson(input: {
  amountCents: number;
  recipientName?: string;
  recipientEmail?: string;
  paid: "in_person" | "comp";
}): Promise<{ success: true; code: string; last4: string; emailed: boolean } | Failure> {
  await requireStaff();
  const { slug, userId, te } = await adminGuard();
  const parsed = sellSchema.safeParse(input);
  if (!parsed.success) {
    const amount = parsed.error.issues.some((issue) => issue.path[0] === "amountCents");
    return { success: false, error: te(amount ? "giftCards.amountRange" : "giftCards.invalidDetails") };
  }
  const email = parsed.data.recipientEmail?.trim() || null;
  const issued = await withTenantDb(slug, (db, tables) =>
    db.transaction((tx) =>
      issueGiftCard(tx, tables, {
        amountCents: parsed.data.amountCents,
        source: parsed.data.paid === "comp" ? "comp" : "in_person",
        recipientName: parsed.data.recipientName?.trim() || null,
        recipientEmail: email,
        createdBy: userId,
      }),
    ),
  );
  let emailed = false;
  if (email) {
    emailed = await sendGiftCardEmail(slug, {
      giftCardId: issued.id,
      to: email,
      recipientName: parsed.data.recipientName?.trim() || null,
      purchaserName: null,
      amountCents: parsed.data.amountCents,
      code: issued.code,
      message: null,
    });
  }
  revalidatePath("/gift-cards");
  return { success: true, code: formatIssuedCode(issued.code), last4: issued.last4, emailed };
}

export async function adjustGiftCardBalance(input: {
  id: string;
  deltaCents: number;
  note: string;
}): Promise<{ success: true; balanceAfter: number } | Failure> {
  await requireStaff();
  const { slug, userId, te } = await adminGuard();
  if (!z.string().uuid().safeParse(input.id).success) {
    return { success: false, error: te("giftCards.notFound") };
  }
  const note = input.note?.trim() ?? "";
  if (!note) return { success: false, error: te("giftCards.noteRequired") };
  try {
    const updated = await withTenantDb(slug, (db, tables) =>
      db.transaction((tx) =>
        adjustGiftCard(tx, tables, {
          id: input.id,
          deltaCents: Math.round(input.deltaCents),
          note,
          createdBy: userId,
        }),
      ),
    );
    revalidatePath("/gift-cards");
    return { success: true, balanceAfter: updated.balanceAfter };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof GiftCardRangeError) return { success: false, error: te("giftCards.outOfRange") };
    if (err instanceof GiftCardInactiveError) return { success: false, error: te("giftCards.inactive") };
    throw err;
  }
}

export async function cancelGiftCard(input: {
  id: string;
  note: string;
}): Promise<{ success: true } | Failure> {
  await requireStaff();
  const { slug, userId, te } = await adminGuard();
  if (!z.string().uuid().safeParse(input.id).success) {
    return { success: false, error: te("giftCards.notFound") };
  }
  const note = input.note?.trim() ?? "";
  if (!note) return { success: false, error: te("giftCards.noteRequired") };
  try {
    await withTenantDb(slug, (db, tables) =>
      db.transaction((tx) => voidGiftCard(tx, tables, { id: input.id, note, createdBy: userId })),
    );
    revalidatePath("/gift-cards");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof GiftCardInactiveError) return { success: false, error: te("giftCards.inactive") };
    throw err;
  }
}

export async function sendNewGiftCardCode(input: {
  id: string;
}): Promise<{ success: true; code: string; last4: string; emailed: boolean } | Failure> {
  await requireStaff();
  const { slug, userId, te } = await adminGuard();
  if (!z.string().uuid().safeParse(input.id).success) {
    return { success: false, error: te("giftCards.notFound") };
  }
  const card = await withTenantDb(slug, async (db, tables) => {
    const [row] = await db
      .select({
        status: tables.giftCards.status,
        recipientEmail: tables.giftCards.recipientEmail,
      })
      .from(tables.giftCards)
      .where(eq(tables.giftCards.id, input.id))
      .limit(1);
    return row ?? null;
  });
  if (!card || card.status !== "active") return { success: false, error: te("giftCards.inactive") };
  if (!card.recipientEmail) return { success: false, error: te("giftCards.noEmail") };
  try {
    const next = await replaceGiftCard(slug, { id: input.id, createdBy: userId });
    revalidatePath("/gift-cards");
    return { success: true, code: formatIssuedCode(next.code), last4: next.last4, emailed: next.emailed };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof GiftCardRangeError) return { success: false, error: te("giftCards.outOfRange") };
    if (err instanceof GiftCardInactiveError) return { success: false, error: te("giftCards.inactive") };
    throw err;
  }
}

/** Staff checkout lookup. The code is not returned. */
export async function lookupGiftCardForCheckout(
  code: string,
): Promise<{ success: true; last4: string; balanceCents: number } | Failure> {
  await requireStaff();
  const { slug, userId, te } = await staffGuard();
  const limit = await consumeRateLimit({
    tenantSlug: slug,
    scope: "identifier",
    key: `gc_lookup:${userId}`,
    limit: 30,
    windowMs: TEN_MIN_MS,
  });
  if (!limit.allowed) return { success: false, error: te("giftCards.rateLimited") };
  const found = await withTenantDb(slug, (db, tables) => findGiftCardByCode(db, tables, code));
  if (!found) return { success: false, error: te("giftCards.notFound") };
  if (found.status !== "active") return { success: false, error: te("giftCards.inactive") };
  if (found.balanceCents <= 0) return { success: false, error: te("giftCards.empty") };
  return { success: true, last4: found.last4, balanceCents: found.balanceCents };
}
