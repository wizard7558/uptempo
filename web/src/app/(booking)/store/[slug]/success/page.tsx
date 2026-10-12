import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CheckCircle2, PackageX } from "lucide-react";
import { getOrderConfirmation } from "@/actions/storefront";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order confirmed · Uptempo",
  robots: { index: false, follow: false },
};

/** Cents → "$X.XX". */
function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function StoreSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { slug } = await params;
  const { session_id } = await searchParams;

  const confirmation = session_id
    ? await getOrderConfirmation(slug, session_id)
    : null;

  const storeHref = `/store/${slug}`;

  if (!confirmation || !confirmation.paid) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-16 text-center sm:px-6 md:max-w-xl lg:max-w-2xl">
        <PackageX
          className="mx-auto size-10 text-[var(--ink-soft)]"
          aria-hidden
        />
        <h1 className="display mt-4 text-3xl text-[var(--ink)]">
          We couldn&rsquo;t confirm your order
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--ink-soft)]">
          If you completed payment, your receipt is on its way. Otherwise, head
          back to the shop and try again.
        </p>
        <div className="mt-6">
          <Button asChild variant="outline" size="lg">
            <Link href={storeHref}>Back to the shop</Link>
          </Button>
        </div>
      </div>
    );
  }

  const shipping = confirmation.fulfillment === "ship";

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16 text-center sm:px-6 md:max-w-xl lg:max-w-2xl">
      <CheckCircle2 className="mx-auto size-10 text-[var(--ink)]" aria-hidden />
      <h1 className="display mt-4 text-3xl text-[var(--ink)]">Order confirmed</h1>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">
        {shipping
          ? "Thanks! Your order is on its way."
          : "Thanks! We'll have it ready for pickup at your next visit."}
      </p>

      <div className="mx-auto mt-6 max-w-xs rounded-lg border border-[var(--line)] px-4 py-4">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-soft)]">
          Total paid
        </p>
        <p className="mt-1 text-2xl text-[var(--ink)]">
          {usd(confirmation.totalCents)}
        </p>
      </div>

      {confirmation.customerEmail && (
        <p className="mt-4 text-xs text-[var(--ink-soft)]">
          A receipt was sent to {confirmation.customerEmail}.
        </p>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        <Button asChild variant="outline" size="lg">
          <Link href={storeHref}>Back to the shop</Link>
        </Button>
        <Button asChild variant="ghost" >
          <Link href={`/book/${slug}`}>
            Book an appointment
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
