import { withTenantDb } from "@/lib/db/tenant";
import { eq, and, isNull, desc } from "drizzle-orm";
import { trackEvent } from "@/lib/analytics/events";

export async function recordSmsConsent(
  tenantSlug: string,
  clientId: string,
  phone: string,
  method: string,
  source: string,
): Promise<void> {
  await withTenantDb(tenantSlug, async (db, { smsConsent }) => {
    await db.insert(smsConsent).values({
      clientId,
      phone,
      consentedAt: new Date(),
      consentMethod: method,
      consentSource: source,
    });
  });
  trackEvent("sms.opted_in", { method }, { tenantSlug });
}

export async function revokeSmsConsent(
  tenantSlug: string,
  phone: string,
): Promise<void> {
  await withTenantDb(tenantSlug, async (db, { smsConsent }) => {
    const [latest] = await db
      .select({ id: smsConsent.id })
      .from(smsConsent)
      .where(
        and(eq(smsConsent.phone, phone), isNull(smsConsent.optedOutAt)),
      )
      .orderBy(desc(smsConsent.createdAt))
      .limit(1);

    if (latest) {
      await db
        .update(smsConsent)
        .set({ optedOutAt: new Date() })
        .where(eq(smsConsent.id, latest.id));
    }
  });
}

export async function checkSmsConsent(
  tenantSlug: string,
  phone: string,
): Promise<boolean> {
  return withTenantDb(tenantSlug, async (db, { smsConsent }) => {
    const [latest] = await db
      .select({
        consentedAt: smsConsent.consentedAt,
        optedOutAt: smsConsent.optedOutAt,
      })
      .from(smsConsent)
      .where(eq(smsConsent.phone, phone))
      .orderBy(desc(smsConsent.createdAt))
      .limit(1);

    if (!latest) return false;
    return latest.consentedAt !== null && latest.optedOutAt === null;
  });
}
