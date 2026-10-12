import Link from "next/link";
import { PricingSlider } from "./pricing-slider";

export default function PricingPage() {
  return (
    <div className="border-b border-[var(--line)] bg-[var(--ivory)] px-6 py-16 md:py-24">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 space-y-6 text-center">
          <div className="inline-flex items-center justify-center gap-3">
            <span className="eyebrow-rule" />
            <span className="eyebrow">
              Transparent pricing
            </span>
            <span className="eyebrow-rule" />
          </div>
          <h1 className="display text-4xl leading-tight text-[var(--ink)] md:text-5xl">
            Pay only when you get paid
          </h1>
          <p className="mx-auto max-w-2xl text-lg font-light leading-relaxed text-[var(--ink-soft)]">
            No monthly fees. Uptempo takes a small percentage of revenue
            processed through the platform. You grow, we grow.
          </p>
        </div>

        <PricingSlider />

        <div className="mt-16 space-y-2 text-center">
          <p className="text-sm text-[var(--ink-soft)]">
            No credit card required to start. Free 14-day trial on all plans.
          </p>
          <p className="text-sm text-[var(--ink-soft)]">
            Need a custom arrangement for your salon group?{" "}
            <Link href="/signup" className="editorial-link text-xs">
              Contact us
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
