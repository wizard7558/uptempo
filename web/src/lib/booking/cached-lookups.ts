import { unstable_cache } from "next/cache";
import { withTenantDb } from "@/lib/db/tenant";
import { getBusinessBySlug } from "@/actions/booking-public";
import { isTenantProvisioned } from "@/lib/tenant/registry";

/**
 * Cross-request caches for the rarely-changing lookups that sit on the
 * critical path of every public booking-group render (generateMetadata,
 * the branded layout, and the tab pages of the native client app). Without
 * these, every tab tap pays 2-3 serial DB round trips before the first byte.
 *
 * Branding is tag-invalidated on save (`branding:<slug>`); everything also
 * carries a 5-minute revalidate as a safety net (tenant renames etc.).
 */
const REVALIDATE_SECONDS = 300;

/** Cached business identity ({ id, name, slug }) for a public slug. */
export function getBusinessBySlugCached(slug: string) {
  return unstable_cache(
    () => getBusinessBySlug(slug),
    ["business-by-slug", slug],
    { tags: [`tenant:${slug}`], revalidate: REVALIDATE_SECONDS },
  )();
}

export interface BookingBranding {
  brandColor: string;
  fontPairing: string;
  cornerStyle: string;
  density: string;
  colorMode: string;
  logoUrl: string | null;
  showPoweredBy: number;
}

async function fetchBookingBranding(
  slug: string,
): Promise<BookingBranding | null> {
  // Unknown / unprovisioned tenants have no schema to query: use defaults.
  if (!(await isTenantProvisioned(slug))) return null;
  return withTenantDb(slug, async (db, { brandingSettings }) => {
    const [settings] = await db
      .select({
        brandColor: brandingSettings.brandColor,
        fontPairing: brandingSettings.fontPairing,
        cornerStyle: brandingSettings.cornerStyle,
        density: brandingSettings.density,
        colorMode: brandingSettings.colorMode,
        logoUrl: brandingSettings.logoUrl,
        showPoweredBy: brandingSettings.showPoweredBy,
      })
      .from(brandingSettings)
      .limit(1);
    return settings ?? null;
  });
}

/** Cached booking-page branding row (only JSON-safe columns). */
export function getBookingBrandingCached(slug: string) {
  return unstable_cache(
    () => fetchBookingBranding(slug),
    ["booking-branding", slug],
    { tags: [`branding:${slug}`], revalidate: REVALIDATE_SECONDS },
  )();
}
