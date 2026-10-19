import type { Metadata } from "next";
import {
  getBusinessBySlugCached,
  getBookingBrandingCached,
} from "@/lib/booking/cached-lookups";

/**
 * Per-business metadata for public tenant pages (/book, /subscribe, /store) so
 * shared links preview the actual page — "Book at Example Studio" with the business's
 * logo — instead of the generic platform blurb from the root layout.
 */
export async function salonPageMetadata(
  slug: string,
  build: (businessName: string) => { title: string; description: string },
): Promise<Metadata> {
  // Cached lookups — generateMetadata blocks the page's first byte, so it
  // must not pay DB round trips on every request.
  const business = await getBusinessBySlugCached(slug);
  // Unknown slug → let the page 404 with default metadata.
  if (!business) return {};

  const { title, description } = build(business.name);
  const fullTitle = `${title} · Uptempo Bookings`;

  // Business logo (absolute Blob URL) as the link-preview image when set.
  let logoUrl: string | null = null;
  try {
    const branding = await getBookingBrandingCached(slug);
    const url = branding?.logoUrl ?? null;
    logoUrl = url && url.startsWith("https://") ? url : null;
  } catch {
    logoUrl = null; // metadata must never break the page
  }

  return {
    title: fullTitle,
    description,
    openGraph: {
      title,
      description,
      siteName: "Uptempo Bookings",
      type: "website",
      ...(logoUrl ? { images: [{ url: logoUrl }] } : {}),
    },
    twitter: {
      card: "summary",
      title,
      description,
      ...(logoUrl ? { images: [logoUrl] } : {}),
    },
  };
}
