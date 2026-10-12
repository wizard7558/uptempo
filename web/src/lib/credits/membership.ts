import { and, eq, sql } from "drizzle-orm";
import type { TenantTransaction } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import { appendCredit } from "./ledger";
import { periodRollover } from "./rollover";

/**
 * Called when a membership invoice is paid for a plan with `kind = 'credits'`.
 * Credits above the carry-over limit expire, then the monthly credits are granted.
 * Calling it again for the same invoice changes nothing.
 */
export async function grantMembershipCredits(
  tx: TenantTransaction,
  tables: TenantTables,
  p: {
    clientMembershipId: string;
    clientId: string;
    planName: string;
    perPeriod: number;
    rolloverMax: number;
    eligible: string[];
    invoiceId: string;
  },
): Promise<{ granted: boolean; balance: number }> {
  const { clientPackages, creditLedger } = tables;

  // credits_remaining is never set here: the ledger trigger owns it.
  await tx
    .insert(clientPackages)
    .values({
      clientId: p.clientId,
      clientMembershipId: p.clientMembershipId,
      name: p.planName,
      eligibleServiceIds: p.eligible,
      expiresAt: null,
    })
    .onConflictDoNothing({
      target: clientPackages.clientMembershipId,
      where: sql`${clientPackages.clientMembershipId} IS NOT NULL`,
    });

  const [pkg] = await tx
    .select({ id: clientPackages.id, creditsRemaining: clientPackages.creditsRemaining })
    .from(clientPackages)
    .where(eq(clientPackages.clientMembershipId, p.clientMembershipId))
    .limit(1)
    .for("update");

  const [done] = await tx
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.clientPackageId, pkg.id),
        eq(creditLedger.reason, "grant"),
        eq(creditLedger.referenceId, p.invoiceId),
      ),
    )
    .limit(1);
  if (done) return { granted: false, balance: pkg.creditsRemaining };

  const { expire, grant } = periodRollover(pkg.creditsRemaining, p.rolloverMax, p.perPeriod);
  if (expire > 0) {
    await appendCredit(tx, tables, {
      clientPackageId: pkg.id,
      delta: -expire,
      reason: "expire",
      referenceId: `rollover:${p.invoiceId}`,
    });
  }
  const entry = await appendCredit(tx, tables, {
    clientPackageId: pkg.id,
    delta: grant,
    reason: "grant",
    referenceId: p.invoiceId,
  });
  return { granted: true, balance: entry.balanceAfter };
}
