import { notFound } from "next/navigation";
import { getTenantSlug } from "@/lib/tenant/context";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { getBusinessBySlugCached } from "@/lib/booking/cached-lookups";
import { getT } from "@/lib/terms/server";
import { loadRequestWizardProps } from "@/lib/requests/wizard-props";
import { RequestWizard } from "@/components/booking-public/request-wizard";

export default async function RequestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlugCached(slug);
  if (!business || !(await isTenantProvisioned(slug))) notFound();
  const tenantSlug = await getTenantSlug();

  if (!(await hasModule(tenantSlug, "requests"))) {
    const t = await getT("requests", tenantSlug);
    return <p className="text-center text-sm font-light text-[var(--ink)]">{t("unavailable")}</p>;
  }

  return <RequestWizard {...(await loadRequestWizardProps(tenantSlug, business))} />;
}
