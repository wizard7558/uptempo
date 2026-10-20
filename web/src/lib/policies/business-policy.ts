import { withTenantDb } from "@/lib/db/tenant";

export async function getBusinessSettingsForTenant(slug: string) {
  return withTenantDb(slug, async (db, { businessSettings }) => {
    const [policy] = await db
      .select()
      .from(businessSettings)
      .limit(1);

    if (policy) return policy;

    const [newPolicy] = await db
      .insert(businessSettings)
      .values({})
      .returning();

    return newPolicy;
  });
}

export async function getPaymentMethodSettingsForTenant(slug: string) {
  const policy = await getBusinessSettingsForTenant(slug);
  return mapPolicyToPaymentMethodSettings(policy);
}

export function mapPolicyToPaymentMethodSettings(policy: unknown) {
  const p = policy as Record<string, unknown>;
  return {
    applePayEnabled: (p.applePayEnabled as number) ?? 1,
    googlePayEnabled: (p.googlePayEnabled as number) ?? 1,
    afterpayEnabled: (p.afterpayEnabled as number) ?? 1,
    cashappEnabled: (p.cashappEnabled as number) ?? 1,
  };
}
