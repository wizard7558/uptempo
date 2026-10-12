import { isSingleMode } from "@/lib/config/mode";
import { getTenantBySlug } from "@/lib/tenant/registry";

export async function getConnectChargeParams(
  slug: string,
  amountCents: number,
): Promise<{ connectAccountId: string; platformFeeCents: number } | null> {
  if (isSingleMode()) return null;
  const tenant = await getTenantBySlug(slug);
  if (!tenant?.stripeConnectAccountId) return null;

  const { calculatePlatformFee } = await import(
    "@/lib/services/charge-processing"
  );
  const platformFeeCents = calculatePlatformFee(amountCents, {
    plan: tenant.plan,
    platformFeePercent: tenant.platformFeePercent,
  });

  return {
    connectAccountId: tenant.stripeConnectAccountId,
    platformFeeCents,
  };
}
