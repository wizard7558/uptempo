import { getT } from "@/lib/terms/server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getStorefront } from "@/actions/storefront";
import { salonPageMetadata } from "@/lib/seo/tenant-metadata";
import { StorePageSkeleton } from "@/components/booking-public/page-skeletons";
import { StoreClient } from "./store-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return salonPageMetadata(slug, (salonName) => ({
    title: `Shop ${salonName}`,
    description: `Shop the products ${salonName} uses and recommends — order online for pickup or delivery.`,
  }));
}

/**
 * Public salon storefront. Shows the salon's retail catalog, with products
 * matching the signed-in client's hair profile surfaced first, and hands off
 * to Stripe-hosted checkout. The booking group layout supplies salon branding
 * and header chrome, so this page renders only its own heading + catalog.
 */
export default async function StorePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Flush the branded shell immediately; the catalog streams in behind the
  // skeleton (this is the native app's Shop tab).
  return (
    <Suspense fallback={<StorePageSkeleton />}>
      <StorePageContent slug={slug} />
    </Suspense>
  );
}

async function StorePageContent({ slug }: { slug: string }) {
  const data = await getStorefront(slug);
  if (!data) {
    notFound();
  }
  const t = await getT("booking", slug);

  const firstName = data.client?.name.trim().split(/\s+/)[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6 md:max-w-2xl lg:max-w-4xl xl:max-w-6xl">
      <div className="mb-6">
        <h1 className="display text-4xl text-[var(--ink)]">
          {data.salonName} Shop
        </h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          {firstName
            ? `Welcome back, ${firstName}. A few things picked with your hair in mind.`
            : t("storePage.handpicked")}
        </p>
      </div>

      <StoreClient slug={slug} data={data} />
    </div>
  );
}
