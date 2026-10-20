import { NextResponse } from "next/server";
import { withTenantDb } from "@/lib/db/tenant";
import { listActiveTenants } from "@/lib/tenant/registry";
import { and, asc, eq, gt } from "drizzle-orm";
import { subMonths } from "date-fns";
import { appendStoredValueLedger } from "@/lib/services/stored-value-ledger";
import { computeExpirableCents } from "@/lib/services/stored-value-expiry";

export const dynamic = "force-dynamic";

/**
 * Daily cron: expire stored value credits older than each business's configured
 * window (`business_settings.stored_value_expiry_months`). Inert for businesses that
 * haven't set a window (the default), so it's safe to run everywhere.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET not set" },
      { status: 500 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const tenants = await listActiveTenants();

  let totalClients = 0;
  let totalCents = 0;
  const results: Array<{
    slug: string;
    clients?: number;
    cents?: number;
    error?: string;
  }> = [];

  for (const tenant of tenants) {
    try {
      const r = await expireForTenant(tenant.slug, now);
      totalClients += r.clients;
      totalCents += r.cents;
      if (r.cents > 0) results.push({ slug: tenant.slug, ...r });
    } catch (error) {
      console.error(
        `[Cron] Stored value expiry failed for ${tenant.slug}:`,
        error,
      );
      results.push({
        slug: tenant.slug,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    clientsAffected: totalClients,
    centsExpired: totalCents,
    tenants: results,
  });
}

async function expireForTenant(
  slug: string,
  now: Date,
): Promise<{ clients: number; cents: number }> {
  const months = await withTenantDb(slug, async (db, { businessSettings }) => {
    const [p] = await db
      .select({ m: businessSettings.storedValueExpiryMonths })
      .from(businessSettings)
      .limit(1);
    return p?.m ?? null;
  });
  if (!months || months <= 0) return { clients: 0, cents: 0 };

  const cutoffMs = subMonths(now, months).getTime();
  // Per-run idempotency key (one expiry posting per client per calendar day).
  const runRef = `expiry:${now.toISOString().slice(0, 10)}`;

  return withTenantDb(slug, async (db, tables) => {
    const { storedValueBalances, storedValueTransactions } = tables;

    // Only clients with a positive balance can have expirable credit.
    const holders = await db
      .select({ clientId: storedValueBalances.clientId })
      .from(storedValueBalances)
      .where(gt(storedValueBalances.balanceCents, 0));

    let clients = 0;
    let cents = 0;

    for (const { clientId } of holders) {
      const txns = await db
        .select({
          amountCents: storedValueTransactions.amountCents,
          createdAt: storedValueTransactions.createdAt,
        })
        .from(storedValueTransactions)
        .where(eq(storedValueTransactions.clientId, clientId))
        .orderBy(asc(storedValueTransactions.createdAt));

      const expirable = computeExpirableCents(
        txns.map((t) => ({
          amountCents: t.amountCents,
          createdAtMs: new Date(t.createdAt).getTime(),
        })),
        cutoffMs,
      );
      if (expirable <= 0) continue;

      // Idempotency: skip if we already posted an expiry for this client today.
      const [dup] = await db
        .select({ id: storedValueTransactions.id })
        .from(storedValueTransactions)
        .where(
          and(
            eq(storedValueTransactions.clientId, clientId),
            eq(storedValueTransactions.referenceId, runRef),
            eq(storedValueTransactions.type, "expiry_debit"),
          ),
        )
        .limit(1);
      if (dup) continue;

      await db.transaction(async (tx) => {
        await appendStoredValueLedger(tx, tables, {
          clientId,
          type: "expiry_debit",
          amountCents: -expirable,
          referenceId: runRef,
          note: `Expired credits older than ${months} months`,
          createdBy: "system",
        });
      });

      clients++;
      cents += expirable;
    }

    return { clients, cents };
  });
}
