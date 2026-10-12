import { and, eq, gt, lte } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { appendCredit } from "./ledger";

/**
 * Expires every active pack whose `expires_at` has passed and still has credits:
 * writes one `expire` row for the whole balance, then marks the pack expired.
 * Each pack is its own transaction and is re-read under lock, so a redeem that
 * lands in between is counted.
 */
export async function expireCreditsForTenant(slug: string, now: Date): Promise<number> {
  const due = await withTenantDb(slug, async (db, { clientPackages }) =>
    db
      .select({ id: clientPackages.id })
      .from(clientPackages)
      .where(
        and(
          eq(clientPackages.status, "active"),
          lte(clientPackages.expiresAt, now),
          gt(clientPackages.creditsRemaining, 0),
        ),
      ),
  );

  let expired = 0;
  for (const { id } of due) {
    await withTenantDb(slug, async (db, tables) => {
      const { clientPackages } = tables;
      await db.transaction(async (tx) => {
        const [pkg] = await tx
          .select({
            remaining: clientPackages.creditsRemaining,
            status: clientPackages.status,
          })
          .from(clientPackages)
          .where(eq(clientPackages.id, id))
          .for("update");
        if (!pkg || pkg.status !== "active") return;
        if (pkg.remaining > 0) {
          await appendCredit(tx, tables, {
            clientPackageId: id,
            delta: -pkg.remaining,
            reason: "expire",
            referenceId: "expiry",
          });
        }
        await tx
          .update(clientPackages)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(clientPackages.id, id));
        expired++;
      });
    });
  }
  return expired;
}
