import Link from "next/link";
import type { Metadata } from "next";
import { Search, ArrowRight } from "lucide-react";
import { listMarketplaceBusinesses } from "@/lib/tenant/registry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find a local business to book · Uptempo",
  description:
    "Browse barbers, nail salons, tattoo studios, massage therapists, trainers and home-service pros, and book online in seconds.",
};

/**
 * Public marketplace. Platform-wide (no tenant), so the copy is industry
 * neutral rather than tenant terms. The client iOS app opens here (it has no
 * URL bar to carry a tenant slug); clients search for a business and tap
 * through to its booking flow at `/book/:slug`.
 */
export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const businesses = await listMarketplaceBusinesses(q);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6 md:max-w-xl lg:max-w-2xl">
      <div className="mb-6">
        <h1 className="display text-4xl text-[var(--ink)]">Find a local business to book</h1>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">
          Browse barbers, nail salons, tattoo studios, massage therapists,
          trainers and home-service pros.
        </p>
      </div>

      <form method="GET" className="mb-6">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search businesses by name"
            aria-label="Search businesses by name"
            className="w-full rounded-lg border border-[var(--line)] bg-transparent py-2.5 pl-9 pr-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--ink)]"
          />
        </div>
      </form>

      {businesses.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--ink-soft)]">
          {q
            ? `No businesses found for “${q}”.`
            : "No businesses are listed yet. Check back soon."}
        </p>
      ) : (
        <ul className="space-y-2">
          {businesses.map((business) => (
            <li key={business.slug}>
              <Link
                href={`/book/${business.slug}`}
                className="group flex items-center justify-between rounded-lg border border-[var(--line)] px-4 py-3 transition-colors hover:border-[var(--ink)]"
              >
                <span className="text-base text-[var(--ink)]">
                  {business.name}
                </span>
                <ArrowRight
                  className="size-4 text-[var(--ink-soft)] transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
