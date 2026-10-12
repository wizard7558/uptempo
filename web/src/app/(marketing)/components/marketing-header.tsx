import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--line)] bg-[var(--ivory)]/90 backdrop-blur-md supports-[backdrop-filter]:bg-[var(--ivory)]/80">
      <div className="mx-auto flex h-[4.5rem] max-w-6xl items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-3">
          <Image src="/uptempo.svg" alt="Uptempo" width={32} height={32} />
          <span className="hidden text-xs font-medium tracking-[0.16em] text-[var(--ink)] transition-colors group-hover:text-[var(--ink-soft)] sm:inline">
            Uptempo
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          <Link
            href="/#features"
            className="editorial-link text-xs"
          >
            Features
          </Link>
          <Link
            href="/pricing"
            className="editorial-link text-xs"
          >
            Pricing
          </Link>
          <Link
            href="/privacy"
            className="editorial-link text-xs"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="editorial-link text-xs"
          >
            Terms
          </Link>
          <Link
            href="/login"
            className="editorial-link text-xs"
          >
            Sign in
          </Link>

          <Button asChild variant="outline" >
            <Link href="/signup">Get started</Link>
          </Button>
        </nav>

        <div className="flex items-center gap-5 md:hidden">
          <Link
            href="/pricing"
            className="editorial-link text-xs"
          >
            Pricing
          </Link>
          <Link
            href="/login"
            className="editorial-link text-xs"
          >
            Sign in
          </Link>
          <Button asChild variant="outline" >
            <Link href="/signup">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
