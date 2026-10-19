import { desc } from "drizzle-orm";
import { DEFAULT_BOOKING_THEME } from "@/lib/booking/theme";
import { getEmailT } from "@/lib/terms/email";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { normalizeLogoUrlForEmail } from "@/lib/email/normalize-logo-url";

export interface EmailBranding {
  businessName: string;
  logoUrl: string | null;
  brandColor: string;
}

export async function getEmailBranding(slug: string): Promise<EmailBranding> {
  const tenant = await getTenantBySlug(slug);
  // The business can be removed between the send decision and this read.
  const businessName = tenant?.name ?? (await getEmailT(slug, "emails"))("fallbacks.ourPlaceTitle");

  let logoUrl: string | null = null;
  let brandColor = DEFAULT_BOOKING_THEME.brandColor;
  try {
    const row = await withTenantDb(slug, async (db, { brandingSettings }) => {
      const [found] = await db
        .select({
          logoUrl: brandingSettings.logoUrl,
          brandColor: brandingSettings.brandColor,
        })
        .from(brandingSettings)
        .orderBy(desc(brandingSettings.updatedAt))
        .limit(1);
      return found ?? null;
    });
    logoUrl = row?.logoUrl ?? null;
    if (row?.brandColor) brandColor = row.brandColor;
  } catch (err) {
    console.warn(
      `[emailBranding] failed to load logo for tenant ${slug}:`,
      err,
    );
  }

  return { businessName, logoUrl: normalizeLogoUrlForEmail(logoUrl), brandColor };
}
