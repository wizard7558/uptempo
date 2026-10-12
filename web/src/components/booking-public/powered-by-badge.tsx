import Link from "next/link";
import { PLATFORM_PRODUCT_NAME } from "@/lib/platform-product";

export function PoweredByBadge({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div className="py-6 text-center">
      <Link
        href="https://bookuptempo.com"
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
      >
        Powered by {PLATFORM_PRODUCT_NAME}
      </Link>
    </div>
  );
}
