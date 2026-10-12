/**
 * Pure, framework-agnostic value formatters.
 *
 * These live in a plain module (no "use client") so both server and client
 * components can call them. `chart-utils.tsx` re-exports them for its existing
 * client consumers; server components should import from here directly.
 */

/** Formats cents to a dollar string with commas: $1,234.56 */
export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Formats a 0-1 ratio as a percentage string: 45.2% */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Formats large numbers compactly: 1000 -> "1K", 1500 -> "1.5K", 1000000 -> "1M".
 * For numbers under 1000, returns as-is.
 */
export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    const val = n / 1_000_000;
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}M`;
  }
  if (Math.abs(n) >= 1_000) {
    const val = n / 1_000;
    return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}K`;
  }
  return String(n);
}
