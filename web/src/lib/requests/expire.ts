import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";

/**
 * Lazy expiry (D4): a sent quote whose valid_until has passed becomes expired,
 * and its request, if still waiting on that quote, becomes expired too.
 * Run on every read that shows request or quote status.
 */
export async function expireStaleQuotes(db: Pick<TenantDb, "update">, t: Pick<TenantTables, "quotes" | "bookingRequests">): Promise<void> {
  const expired = await db
    .update(t.quotes)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(and(eq(t.quotes.status, "sent"), lt(t.quotes.validUntil, sql`now()`)))
    .returning({ requestId: t.quotes.requestId });
  if (expired.length === 0) return;
  await db
    .update(t.bookingRequests)
    .set({ status: "expired", updatedAt: sql`now()` })
    .where(
      and(
        inArray(
          t.bookingRequests.id,
          expired.map((e) => e.requestId),
        ),
        eq(t.bookingRequests.status, "quoted"),
      ),
    );
}
