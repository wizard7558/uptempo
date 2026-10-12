"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import { formatCompact, formatCurrency } from "@/lib/format";
import { cumulativeRevenueSeries } from "@/lib/dashboard/view";

interface RevenueChartProps {
  /** Per-day revenue for the current month, in cents. */
  series: { date: string; revenueCents: number }[];
}

/**
 * Month-to-date revenue as a quiet rising line. The per-day series is
 * accumulated so the shape reads as steady growth rather than daily noise, in
 * keeping with the editorial dashboard mockup.
 */
export function RevenueChart({ series }: RevenueChartProps) {
  const data = cumulativeRevenueSeries(series).map((p) => ({
    label: format(new Date(`${p.date}T00:00:00`), "MMM d"),
    dollars: p.cumulativeCents / 100,
    cents: p.cumulativeCents,
  }));

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        No revenue yet this month.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke="var(--border)"
          strokeDasharray="0"
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          minTickGap={28}
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickFormatter={(v: number) => `$${formatCompact(v)}`}
        />
        <Tooltip
          cursor={{ stroke: "var(--border)" }}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "0.5rem",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
          formatter={(value) => [formatCurrency(Number(value) * 100), "Revenue"]}
        />
        <Line
          type="monotone"
          dataKey="dollars"
          stroke="var(--foreground)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, fill: "var(--foreground)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
