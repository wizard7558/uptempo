import Link from "next/link";
import Image from "next/image";
import { SourceLink } from "@/components/layout/source-link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--ivory-raised)]">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Image src="/uptempo.svg" alt="Uptempo" width={28} height={28} />
              <span className="text-xs font-medium tracking-[0.16em] text-[var(--ink)]">
                Uptempo
              </span>
            </div>
            <p className="max-w-xs text-sm font-light leading-relaxed text-[var(--ink-soft)]">
              The all-in-one platform to run your salon — booking, scheduling,
              clients, payments, memberships, and revenue.
            </p>
          </div>
          <div className="space-y-4">
            <h3 className="eyebrow">Product</h3>
            <nav className="flex flex-col gap-2">
              <Link href="/#features" className="editorial-link text-xs">
                Features
              </Link>
              <Link href="/pricing" className="editorial-link text-xs">
                Pricing
              </Link>
              <Link href="/signup" className="editorial-link text-xs">
                Get started
              </Link>
              <Link href="/waitlist" className="editorial-link text-xs">
                Join the waitlist
              </Link>
            </nav>
          </div>
          <div className="space-y-4">
            <h3 className="eyebrow">Legal</h3>
            <nav className="flex flex-col gap-2">
              <Link href="/privacy" className="editorial-link text-xs">
                Privacy Policy
              </Link>
              <Link href="/terms" className="editorial-link text-xs">
                Terms of Service
              </Link>
              <Link href="/login" className="editorial-link text-xs">
                Sign in
              </Link>
              <SourceLink className="editorial-link text-xs" />
            </nav>
          </div>
        </div>
        <div className="mt-12 border-t border-[var(--line)] pt-6 text-center text-xs text-[var(--ink-soft)]">
          <p>&copy; {new Date().getFullYear()} Uptempo. All rights reserved.</p>
          <p className="mt-2">
            Uptempo is an all-in-one salon booking and management platform.{" "}
            <Link href="/privacy" className="editorial-link text-xs">
              Privacy Policy
            </Link>
            {" · "}
            <Link href="/terms" className="editorial-link text-xs">
              Terms of Service
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
