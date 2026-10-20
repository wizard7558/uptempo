import { processingFeeCents } from "@/lib/billing/processing-fee";
import { isSingleMode } from "@/lib/config/mode";
import { getTenantBySlug } from "@/lib/tenant/registry";

export async function getConnectChargeParams(
  slug: string,
  amountCents: number,
): Promise<{ connectAccountId: string; platformFeeCents: number } | null> {
  if (isSingleMode()) return null;
  const tenant = await getTenantBySlug(slug);
  if (!tenant?.stripeConnectAccountId) return null;

  return {
    connectAccountId: tenant.stripeConnectAccountId,
    platformFeeCents: processingFeeCents(amountCents, tenant),
  };
}
