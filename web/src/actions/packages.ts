"use server";

import { destinationRefundParams } from "@/lib/stripe/refund-params";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { assertModule, hasModule, ModuleDisabledError } from "@/lib/tenant/modules";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { processOffSessionCharge } from "@/lib/services/charge-processing";
import { getStripe } from "@/lib/stripe/server";
import { appendCredit, CreditError } from "@/lib/credits/ledger";

type Failure = { success: false; error: string };
const fail = (error: string): Failure => ({ success: false, error });

/** A second sale of the same pack to the same client inside this window is refused. */
const DUPLICATE_WINDOW_MS = 60_000;

export type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  credits: number;
  validDays: number | null;
  eligibleServiceIds: string[];
  isActive: boolean;
};

export type ClientPackageRow = {
  id: string;
  name: string;
  creditsRemaining: number;
  creditsTotal: number;
  expiresAt: Date | null;
  status: string;
};

export type LedgerRow = {
  id: string;
  clientPackageId: string;
  packageName: string;
  createdAt: Date;
  /** "+10" or "−1" (a real minus sign). */
  change: string;
  /** One of the `packages.reasons.*` keys. */
  reason: string;
  balanceAfter: number;
  note: string | null;
};

export type ClientCredits = {
  packages: ClientPackageRow[];
  ledger: LedgerRow[];
  /** Owner and admin may sell packs and adjust credits; providers only look. */
  canManage: boolean;
};

/** Staff session + module gate for the owner/admin actions. */
async function adminGuard() {
  const auth = await requireRole("owner", "admin");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  await assertModule(slug, "packages");
  const t = await getT("packages", slug);
  return { slug, userId: auth.userId, t };
}

function asFailure(err: unknown): Failure {
  if (err instanceof ModuleDisabledError) return fail(err.message);
  throw err;
}

const rowOf = (p: {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  credits: number;
  validDays: number | null;
  eligibleServiceIds: string[];
  isActive: number;
}): PackageRow => ({ ...p, isActive: p.isActive === 1 });

export async function listPackages(): Promise<PackageRow[]> {
  await requireStaff();
  const g = await adminGuard();
  const rows = await withTenantDb(g.slug, async (db, { packages }) =>
    db.select().from(packages).orderBy(asc(packages.sort), asc(packages.createdAt)),
  );
  return rows.map(rowOf);
}

const savePackageSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  priceCents: z.number().int().min(0).max(10_000_000),
  credits: z.number().int().min(1).max(500),
  validDays: z.number().int().min(1).max(3650).nullable(),
  eligibleServiceIds: z.array(z.uuid()).max(500),
  isActive: z.boolean(),
});
export type SavePackageInput = z.input<typeof savePackageSchema>;

export async function savePackage(
  input: SavePackageInput,
): Promise<{ success: true; id: string } | Failure> {
  await requireStaff();
  let g: Awaited<ReturnType<typeof adminGuard>>;
  try {
    g = await adminGuard();
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  const parsed = savePackageSchema.safeParse(input);
  if (!parsed.success) return fail(g.t("errors.invalid"));
  const d = parsed.data;
  const values = {
    name: d.name,
    description: d.description?.trim() ? d.description.trim() : null,
    priceCents: d.priceCents,
    credits: d.credits,
    validDays: d.validDays,
    eligibleServiceIds: [...new Set(d.eligibleServiceIds)],
    isActive: d.isActive ? 1 : 0,
    updatedAt: new Date(),
  };
  const id = await withTenantDb(g.slug, async (db, { packages }) => {
    if (d.id) {
      const [row] = await db
        .update(packages)
        .set(values)
        .where(eq(packages.id, d.id))
        .returning({ id: packages.id });
      return row?.id ?? null;
    }
    const [row] = await db.insert(packages).values(values).returning({ id: packages.id });
    return row.id;
  });
  if (!id) return fail(g.t("errors.notFound"));
  revalidatePath("/settings/packages");
  return { success: true, id };
}

const clientIdSchema = z.uuid();

export async function getClientCredits(clientId: string): Promise<ClientCredits> {
  const auth = await requireRole("owner", "admin", "provider");
  if (!auth.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = auth.tenantSlug;
  await assertModule(slug, "packages");
  const id = clientIdSchema.parse(clientId);

  return withTenantDb(slug, async (db, { clientPackages, creditLedger }) => {
    const pkgs = await db
      .select({
        id: clientPackages.id,
        name: clientPackages.name,
        creditsRemaining: clientPackages.creditsRemaining,
        creditsTotal: clientPackages.creditsTotal,
        expiresAt: clientPackages.expiresAt,
        status: clientPackages.status,
      })
      .from(clientPackages)
      .where(eq(clientPackages.clientId, id))
      .orderBy(desc(clientPackages.createdAt));
    const names = new Map(pkgs.map((p) => [p.id, p.name]));
    const entries = pkgs.length
      ? await db
          .select({
            id: creditLedger.id,
            clientPackageId: creditLedger.clientPackageId,
            createdAt: creditLedger.createdAt,
            delta: creditLedger.delta,
            reason: creditLedger.reason,
            balanceAfter: creditLedger.balanceAfter,
            note: creditLedger.note,
          })
          .from(creditLedger)
          .where(
            inArray(
              creditLedger.clientPackageId,
              pkgs.map((p) => p.id),
            ),
          )
          .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      : [];
    return {
      packages: pkgs,
      ledger: entries.map((e) => ({
        id: e.id,
        clientPackageId: e.clientPackageId,
        packageName: names.get(e.clientPackageId) ?? "",
        createdAt: e.createdAt,
        change: e.delta > 0 ? `+${e.delta}` : `−${Math.abs(e.delta)}`,
        reason: e.reason,
        balanceAfter: e.balanceAfter,
        note: e.note,
      })),
      canManage: auth.role === "owner" || auth.role === "admin",
    };
  });
}

/** Refunds a card payment. Used only to undo a charge whose pack could not be saved. */
async function refundPayment(
  paymentIntentId: string,
  connectAccountId: string | null,
): Promise<boolean> {
  // Same test-only seam as processOffSessionCharge: fake intents have nothing to refund.
  if (
    process.env.PAYMENTS_FAKE === "1" &&
    process.env.VERCEL_ENV !== "production" &&
    process.env.NODE_ENV !== "production"
  ) {
    return true;
  }
  try {
    await getStripe().refunds.create({
      payment_intent: paymentIntentId,
      ...destinationRefundParams(connectAccountId, { undo: true }),
    });
    return true;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error("[packages] refund after failed pack save also failed:", paymentIntentId, err);
    return false;
  }
}

type SaleResult =
  | { success: true; clientPackageId: string; balance: number }
  | { success: false; error: string; needsCard?: boolean };

/**
 * Sells one pack to one client. Charges first, then writes the pack, the ledger row and
 * the charge row in one transaction. If that transaction fails after a card payment
 * went through, the payment is refunded, so a paid charge never ends without a pack.
 */
async function sellPack(p: {
  slug: string;
  clientId: string;
  packageId: string;
  payment: "card_on_file" | "cash";
  createdBy: string;
}): Promise<SaleResult> {
  const t = await getT("packages", p.slug);
  const { slug } = p;

  const found = await withTenantDb(slug, async (db, { packages, clients, clientPackages }) => {
    const [pack] = await db
      .select()
      .from(packages)
      .where(and(eq(packages.id, p.packageId), eq(packages.isActive, 1)))
      .limit(1);
    const [client] = await db
      .select({
        id: clients.id,
        stripeCustomerId: clients.stripeCustomerId,
        stripePaymentMethodId: clients.stripePaymentMethodId,
      })
      .from(clients)
      .where(eq(clients.id, p.clientId))
      .limit(1);
    const recent = pack
      ? await db
          .select({ id: clientPackages.id })
          .from(clientPackages)
          .where(
            and(
              eq(clientPackages.clientId, p.clientId),
              eq(clientPackages.packageId, p.packageId),
              gt(clientPackages.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS)),
            ),
          )
          .limit(1)
      : [];
    return { pack, client, recent: recent.length > 0 };
  });

  if (!found.pack) return fail(t("errors.notFound"));
  if (!found.client) return fail(t("errors.clientNotFound"));
  if (found.recent) return fail(t("errors.duplicate"));
  const { pack, client } = found;

  // A free pack has nothing to charge, whatever the payment choice.
  const chargesCard = p.payment === "card_on_file" && pack.priceCents > 0;
  if (chargesCard && (!client.stripeCustomerId || !client.stripePaymentMethodId)) {
    return { success: false, error: t("errors.noCard"), needsCard: true };
  }

  let paymentIntentId: string | null = null;
  let chargeStatus: "completed" | "pending" = "completed";
  let connect: { connectAccountId: string; platformFeeCents: number } | null = null;
  if (chargesCard) {
    const { getConnectChargeParams } = await import("@/lib/stripe/connect-charge-params");
    connect = await getConnectChargeParams(slug, pack.priceCents);
    const result = await processOffSessionCharge({
      amountCents: pack.priceCents,
      stripeCustomerId: client.stripeCustomerId!,
      stripePaymentMethodId: client.stripePaymentMethodId!,
      metadata: {
        reason: "package_sale",
        packageId: pack.id,
        clientId: client.id,
        tenantSlug: slug,
      },
      ...(connect
        ? { connectAccountId: connect.connectAccountId, platformFeeCents: connect.platformFeeCents }
        : {}),
      // One key per client, pack, card and minute: a double click reuses the same payment.
      idempotencyKey: `pack-sale:${slug}:${client.id}:${pack.id}:${client.stripePaymentMethodId}:${Math.floor(Date.now() / DUPLICATE_WINDOW_MS)}`,
    });
    if (result.status === "failed") return fail(t("errors.cardFailed"));
    paymentIntentId = result.stripePaymentIntentId;
    chargeStatus = result.status;
  }

  try {
    const out = await withTenantDb(slug, async (db, tables) =>
      db.transaction(async (tx) => {
        const [cp] = await tx
          .insert(tables.clientPackages)
          .values({
            clientId: client.id,
            packageId: pack.id,
            name: pack.name,
            eligibleServiceIds: pack.eligibleServiceIds,
            expiresAt: pack.validDays ? new Date(Date.now() + pack.validDays * 86_400_000) : null,
            priceCents: pack.priceCents,
            stripePaymentIntentId: paymentIntentId,
          })
          .returning({ id: tables.clientPackages.id });
        const entry = await appendCredit(tx, tables, {
          clientPackageId: cp.id,
          delta: pack.credits,
          reason: "purchase",
          referenceId: paymentIntentId ?? `cash:${cp.id}`,
          createdBy: p.createdBy,
        });
        await tx.insert(tables.charges).values({
          appointmentId: null,
          clientPackageId: cp.id,
          clientId: client.id,
          stripePaymentIntentId: paymentIntentId,
          amountCents: pack.priceCents,
          reason: "package_sale",
          status: chargeStatus,
          platformFeeCents: connect?.platformFeeCents ?? null,
          connectAccountId: connect?.connectAccountId ?? null,
        });
        return { clientPackageId: cp.id, balance: entry.balanceAfter };
      }),
    );
    return { success: true, ...out };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error("[packages] could not save the pack:", err);
    if (paymentIntentId) {
      const refunded = await refundPayment(paymentIntentId, connect?.connectAccountId ?? null);
      return fail(refunded ? t("errors.refunded") : t("errors.refundFailed"));
    }
    return fail(t("errors.generic"));
  }
}

const sellSchema = z.object({
  clientId: z.uuid(),
  packageId: z.uuid(),
  payment: z.enum(["card_on_file", "cash"]),
});

export async function sellPackageAdmin(
  input: z.input<typeof sellSchema>,
): Promise<{ success: true; clientPackageId: string } | Failure> {
  await requireStaff();
  let g: Awaited<ReturnType<typeof adminGuard>>;
  try {
    g = await adminGuard();
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  const parsed = sellSchema.safeParse(input);
  if (!parsed.success) return fail(g.t("errors.invalid"));
  const res = await sellPack({ slug: g.slug, ...parsed.data, createdBy: g.userId });
  if (!res.success) return fail(res.error);
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return { success: true, clientPackageId: res.clientPackageId };
}

const adjustSchema = z.object({
  clientPackageId: z.uuid(),
  delta: z
    .number()
    .int()
    .min(-50)
    .max(50)
    .refine((n) => n !== 0),
  note: z.string().trim().min(1).max(200),
});

export async function adjustCredits(
  input: z.input<typeof adjustSchema>,
): Promise<{ success: true; balance: number } | Failure> {
  await requireStaff();
  let g: Awaited<ReturnType<typeof adminGuard>>;
  try {
    g = await adminGuard();
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return fail(g.t("errors.invalid"));
  const d = parsed.data;
  try {
    const out = await withTenantDb(g.slug, async (db, tables) =>
      db.transaction(async (tx) => {
        const [cp] = await tx
          .select({ clientId: tables.clientPackages.clientId })
          .from(tables.clientPackages)
          .where(eq(tables.clientPackages.id, d.clientPackageId))
          .limit(1);
        if (!cp) return null;
        const entry = await appendCredit(tx, tables, {
          clientPackageId: d.clientPackageId,
          delta: d.delta,
          reason: "adjust",
          note: d.note,
          createdBy: g.userId,
        });
        return { balance: entry.balanceAfter, clientId: cp.clientId };
      }),
    );
    if (!out) return fail(g.t("errors.notFound"));
    revalidatePath(`/clients/${out.clientId}`);
    return { success: true, balance: out.balance };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (err instanceof CreditError) return fail(g.t("insufficient"));
    throw err;
  }
}

export type PublicPackage = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  credits: number;
  validDays: number | null;
};

/** Packs on sale, for the public page. Empty when the module is off. */
export async function listPackagesPublic(): Promise<PublicPackage[]> {
  const slug = await getTenantSlug();
  if (!(await hasModule(slug, "packages"))) return [];
  return withTenantDb(slug, async (db, { packages }) =>
    db
      .select({
        id: packages.id,
        name: packages.name,
        description: packages.description,
        priceCents: packages.priceCents,
        credits: packages.credits,
        validDays: packages.validDays,
      })
      .from(packages)
      .where(eq(packages.isActive, 1))
      .orderBy(asc(packages.sort), asc(packages.createdAt)),
  );
}

/**
 * The signed-in client buys a pack with the card on file. Returns `needsCard` when
 * they have none yet; the page then saves a card and calls this again.
 */
export async function buyPackage(
  packageId: string,
): Promise<{ success: true; count: number } | { success: false; error?: string; needsCard?: true }> {
  const slug = await getTenantSlug();
  const t = await getT("packages", slug);
  try {
    await assertModule(slug, "packages");
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return asFailure(err);
  }
  const clientId = await getBookingSession();
  if (!clientId) return fail(t("signInFirst"));
  const parsed = z.uuid().safeParse(packageId);
  if (!parsed.success) return fail(t("errors.invalid"));

  const res = await sellPack({
    slug,
    clientId,
    packageId: parsed.data,
    payment: "card_on_file",
    createdBy: `client:${clientId}`,
  });
  if (res.success) return { success: true, count: res.balance };
  if (res.needsCard) return { success: false, needsCard: true };
  return fail(res.error);
}
