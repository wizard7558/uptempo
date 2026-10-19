import { notFound } from "next/navigation";
import { getTenantSlug } from "@/lib/tenant/context";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { getBusinessBySlugCached } from "@/lib/booking/cached-lookups";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { getT } from "@/lib/terms/server";
import { listPackagesPublic } from "@/actions/packages";
import { PacksView } from "@/components/booking-public/packs-view";

export default async function PacksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlugCached(slug);
  if (!business || !(await isTenantProvisioned(slug))) notFound();
  const tenantSlug = await getTenantSlug();

  if (!(await hasModule(tenantSlug, "packages"))) {
    const t = await getT("packages", tenantSlug);
    return <p className="text-center text-sm font-light text-[var(--ink)]">{t("unavailable")}</p>;
  }

  const [packs, sessionClientId] = await Promise.all([listPackagesPublic(), getBookingSession()]);
  return (
    <PacksView
      salonId={business.id}
      salonName={business.name}
      packs={packs}
      signedIn={Boolean(sessionClientId)}
    />
  );
}
