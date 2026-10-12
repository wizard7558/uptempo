import type { Metadata } from "next";
import {
  getSalonBySlugCached,
  getBookingBrandingCached,
} from "@/lib/booking/cached-lookups";

/**
 * Per-salon metadata for public tenant pages (/book, /subscribe, /store) so
 * shared links preview the actual page — "Book at Example Studio" with the salon's
 * logo — instead of the generic platform blurb from the root layout.
 */
export async function salonPageMetadata(
  slug: string,
  build: (salonName: string) => { title: string; description: string },
): Promise<Metadata> {
  // Cached lookups — generateMetadata blocks the page's first byte, so it
  // must not pay DB round trips on every request.
  const salon = await getSalonBySlugCached(slug);
  // Unknown slug → let the page 404 with default metadata.
  if (!salon) return {};

  const { title, description } = build(salon.name);
  const fullTitle = `${title} · Uptempo Bookings`;

  // Salon logo (absolute Blob URL) as the link-preview image when set.
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
