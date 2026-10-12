import { asc, eq } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { withTenantDb } from "@/lib/db/tenant";

export type QuoteDeliveryData = {
  token: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  subtotalCents: number;
  depositCents: number;
  validUntilLabel: string;
  lines: { description: string; quantity: number; unitCents: number }[];
};

/** Everything needed to tell the client about a sent quote. Null when the quote is gone. */
export async function loadQuoteForDelivery(
  slug: string,
  quoteId: string,
): Promise<QuoteDeliveryData | null> {
  return withTenantDb(slug, async (db, t) => {
    const [row] = await db
      .select({
        token: t.quotes.accessToken,
        subtotalCents: t.quotes.subtotalCents,
        depositCents: t.quotes.depositCents,
        validUntil: t.quotes.validUntil,
        clientId: t.clients.id,
        clientName: t.clients.name,
        clientEmail: t.clients.email,
        clientPhone: t.clients.phone,
      })
      .from(t.quotes)
      .innerJoin(t.bookingRequests, eq(t.bookingRequests.id, t.quotes.requestId))
      .innerJoin(t.clients, eq(t.clients.id, t.bookingRequests.clientId))
      .where(eq(t.quotes.id, quoteId))
      .limit(1);
    if (!row) return null;
    const [settings] = await db.select({ timezone: t.businessSettings.timezone }).from(t.businessSettings).limit(1);
    const lines = await db
      .select({
        description: t.quoteLineItems.description,
        quantity: t.quoteLineItems.quantity,
        unitCents: t.quoteLineItems.unitCents,
      })
      .from(t.quoteLineItems)
      .where(eq(t.quoteLineItems.quoteId, quoteId))
      .orderBy(asc(t.quoteLineItems.sort));
    const until = row.validUntil ? new TZDate(row.validUntil, settings?.timezone ?? "America/New_York") : null;
    return {
      token: row.token,
      clientId: row.clientId,
      clientName: row.clientName,
      clientEmail: row.clientEmail,
      clientPhone: row.clientPhone,
      subtotalCents: row.subtotalCents,
      depositCents: row.depositCents,
      validUntilLabel: until ? format(until, "MMMM d, yyyy") : "",
      lines,
    };
  });
}
