"use client";

/**
 * Series colours, theme-driven with a hard-coded fallback.
 *
 * The `hsl()` belongs around the *fallback*, not the whole `var()`: --chart-1..5
 * are defined in globals.css as complete hsl() functions, so the old
 * `hsl(var(--chart-1, ...))` form substituted to `hsl(hsl(25 9% 35%))` — invalid,
 * and silently dropped. Only series 6-8 rendered, because those vars are
 * undefined and so fell through to the raw-channel fallback.
 */
export const chartColors = [
  "var(--chart-1, hsl(142 71% 45%))", // primary green
  "var(--chart-2, hsl(221 83% 53%))", // blue
  "var(--chart-3, hsl(38 92% 50%))", // amber
  "var(--chart-4, hsl(0 84% 60%))", // red
  "var(--chart-5, hsl(262 83% 58%))", // purple
  "var(--chart-6, hsl(174 72% 46%))", // teal
  "var(--chart-7, hsl(330 81% 60%))", // pink
  "var(--chart-8, hsl(25 95% 53%))", // orange
];

// The pure formatters live in a server-safe module so Server Components can call
// them too. Re-exported here so existing client consumers keep importing from
// "@/components/ui/chart-utils" unchanged.
export { formatCurrency, formatPercent, formatCompact } from "@/lib/format";

/**
 * A simple "No data for this period" placeholder with dashed border and muted text.
 */
export function EmptyChart({
  message = "No data for this period",
  className = "",
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md border border-dashed p-8 text-center ${className}`}
    >
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
