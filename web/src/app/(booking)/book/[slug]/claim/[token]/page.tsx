import { notFound } from "next/navigation";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { isPublicTokenShape } from "@/lib/security/public-token";
import { loadWaitlistClaim } from "@/actions/slot-waitlist-public";
import { ClaimClient } from "./claim-client";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export default async function WaitlistClaimPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  if (!SLUG_RE.test(slug) || !isPublicTokenShape(token)) notFound();
  const host = await getTenantSlug();
  if (host !== slug) notFound();
  if (!(await isTenantProvisioned(slug)) || !(await hasModule(slug, "slot_waitlist"))) notFound();
  const offer = await loadWaitlistClaim(token);
  return <ClaimClient token={token} offer={offer} />;
}
