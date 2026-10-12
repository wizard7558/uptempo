import type { Metadata } from "next";
import { sourceFromSearchParams } from "@/lib/attribution";
import { QuizForm } from "./quiz-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quick feedback",
  robots: { index: false, follow: false },
};

/**
 * Platform-level prospect/audience quiz. Shared as a private link (not linked
 * from any nav) to gather market-research feedback from solo service providers.
 * Renders under the (booking) group's no-tenant chrome.
 *
 * Honors `?src=<label>` for attribution so QR codes and campaign links can be
 * told apart (see `scripts/generate-qr-codes.mjs`).
 */
export default async function QuizPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const source = sourceFromSearchParams(await searchParams);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6 md:max-w-xl lg:max-w-2xl">
      <div className="mb-6">
        <h1 className="display text-4xl text-foreground">
          Help us build it right
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A few quick questions about how you run your business. Skip anything
          you want — every answer helps.
        </p>
      </div>

      <QuizForm source={source} />
    </div>
  );
}
