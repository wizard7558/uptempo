import type { Metadata } from "next";
import Link from "next/link";
import { sourceFromSearchParams } from "@/lib/attribution";
import { WaitlistForm } from "./waitlist-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join the waitlist — Uptempo Bookings",
  description:
    "Be first in line when Uptempo opens up. Leave your details and we'll reach out when your spot is ready.",
};

const PERKS = [
  "First access when we open the next round of salons",
  "Founding-member pricing, locked in",
  "A say in what we build — we ask, we listen",
];

/**
 * Public pre-launch waitlist. Unlike `/quiz` (a private, noindex link) this is
 * a linked, indexable marketing page — it renders under the (marketing) group's
 * header/footer chrome.
 *
 * Honors `?src=<label>` for attribution so QR codes and campaign links can be
 * told apart (see `scripts/generate-qr-codes.mjs`).
 */
export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const source = sourceFromSearchParams(await searchParams);

  return (
    <div className="bg-background">
      <section className="px-6 py-20 md:py-28">
        <div className="mx-auto grid max-w-5xl gap-14 lg:grid-cols-12 lg:gap-20">
          <div className="space-y-8 lg:col-span-6">
            <div className="inline-flex items-center gap-4">
              <span className="eyebrow-rule" />
              <span className="eyebrow">Coming soon</span>
            </div>

            <h1 className="display text-4xl leading-[1.05] text-foreground md:text-6xl">
              Save your
              <br />
              <em className="text-[#6f7f1d]">place in line.</em>
            </h1>

            <p className="max-w-md text-lg font-light leading-relaxed text-muted-foreground">
              We&apos;re opening Uptempo to a small number of salons at a time so
              every one of them gets set up properly. Leave your details and
              we&apos;ll reach out the moment your spot is ready.
            </p>

            <ul className="space-y-4 border-t border-border pt-8">
              {PERKS.map((perk) => (
                <li
                  key={perk}
                  className="flex items-start gap-4 text-sm font-light leading-relaxed text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className="mt-1 font-display text-base italic text-[#6f7f1d]"
                  >
                    ✦
                  </span>
                  {perk}
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-5 lg:col-start-8">
            <WaitlistForm source={source} />

            <p className="mt-8 text-xs leading-relaxed text-muted-foreground">
              We&apos;ll only use your details to tell you about early access.
              See our{" "}
              <Link href="/privacy" className="editorial-link text-xs">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
