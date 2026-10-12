"use client";

import { useState } from "react";
import { useT } from "@/lib/terms/client";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { format } from "date-fns";
import {
  formatCurrency,
  formatCompact,
  EmptyChart,
} from "@/components/ui/chart-utils";
import { Button } from "@/components/ui/button";
import { getAnalyticsDashboard } from "@/actions/analytics";

type GranularityOption = "auto" | "day" | "week" | "month";

interface AnalyticsChartsProps {
  data: Awaited<ReturnType<typeof getAnalyticsDashboard>>;
  granularity: GranularityOption;
  onGranularityChange: (granularity: GranularityOption) => void;
  disabled?: boolean;
}

// Explicit, distinct colors so series stay distinguishable regardless of the
// theme's --chart-* overrides (which render the default palette near-black).
const SERIES = {
  revenue: "hsl(142 71% 45%)", // green
  bookings: "hsl(221 83% 53%)", // blue
  perBooking: "hsl(38 92% 50%)", // amber
} as const;

type TrendKey = "revenue" | "bookings" | "perBooking";

export function AnalyticsCharts({
  data,
  granularity,
  onGranularityChange,
  disabled = false,
}: AnalyticsChartsProps) {
  const t = useT("reports");
  const [visible, setVisible] = useState<Record<TrendKey, boolean>>({
    revenue: true,
    bookings: true,
    perBooking: true,
  });

  function toggle(key: TrendKey) {
    setVisible((v) => ({ ...v, [key]: !v[key] }));
  }

  const revenueTrendData = data.revenueTrend.map((row) => ({
    date: format(new Date(row.period), "MMM d"),
    revenue: row.totalCents / 100,
    bookings: row.count,
    perBooking: row.count > 0 ? row.totalCents / row.count / 100 : 0,
  }));

  const serviceData = data.servicePopularity.slice(0, 8).map((row) => ({
    name:
      row.serviceName.length > 20
        ? row.serviceName.slice(0, 20) + "..."
        : row.serviceName,
    bookings: row.bookingCount,
    revenue: row.revenueCents / 100,
  }));

  const returnFrequencyData = data.returnFrequency.map((row) => ({
    name: row.label,
    count: row.count,
  }));
  const hasReturnData = returnFrequencyData.some((r) => r.count > 0);

  const utilizationData = data.staffUtilization.map((row) => ({
    name:
      row.staffName.length > 15
        ? row.staffName.slice(0, 15) + "..."
        : row.staffName,
    utilization: row.utilizationPercent,
  }));

  const trendToggles: { key: TrendKey; label: string }[] = [
    { key: "revenue", label: "Revenue" },
    { key: "bookings", label: "Bookings" },
    { key: "perBooking", label: "Revenue / booking" },
  ];

  return (
    <>
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Revenue Trend</h3>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { key: "auto", label: "Auto" },
                  { key: "day", label: "Day" },
                  { key: "week", label: "Week" },
                  { key: "month", label: "Month" },
                ] as const
              ).map(({ key, label }) => (
                <Button
                  key={key}
                  variant={granularity === key ? "default" : "outline"}
                  
                  disabled={disabled}
                  onClick={() => onGranularityChange(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {trendToggles.map(({ key, label }) => (
              <Button
                key={key}
                variant={visible[key] ? "default" : "outline"}
                
                onClick={() => toggle(key)}
              >
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: visible[key] ? SERIES[key] : "transparent",
                    border: `1.5px solid ${SERIES[key]}`,
                  }}
                />
                {label}
              </Button>
            ))}
          </div>
        </div>
        {revenueTrendData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={revenueTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis
                yAxisId="dollars"
                tickFormatter={(v) => formatCompact(Number(v))}
                fontSize={12}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                allowDecimals={false}
                fontSize={12}
              />
              <Tooltip
                formatter={(v, name) =>
                  name === "Bookings"
                    ? [Number(v), name]
                    : [formatCurrency(Number(v) * 100), name]
                }
              />
              {visible.revenue && (
                <Line
                  yAxisId="dollars"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke={SERIES.revenue}
                  strokeWidth={2}
                  dot={false}
                />
              )}
              {visible.perBooking && (
                <Line
                  yAxisId="dollars"
                  type="monotone"
                  dataKey="perBooking"
                  name="Revenue / booking"
                  stroke={SERIES.perBooking}
                  strokeWidth={2}
                  dot={false}
                />
              )}
              {visible.bookings && (
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="bookings"
                  name="Bookings"
                  stroke={SERIES.bookings}
                  strokeWidth={2}
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart />
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Left axis: dollars (revenue, revenue/booking). Right axis: booking
          count.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-1 text-lg font-semibold">Client loyalty</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Clients grouped by lifetime visit count (all-time, not limited to the
          selected range).
        </p>
        {hasReturnData ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={returnFrequencyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} interval={0} />
              <YAxis allowDecimals={false} fontSize={12} />
              <Tooltip formatter={(v) => [Number(v), "Clients"]} />
              <Bar dataKey="count" fill={SERIES.bookings} name="Clients" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChart message="No client visit history yet" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-4 text-lg font-semibold">Top Services</h3>
          {serviceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={serviceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  xAxisId="bookings"
                  type="number"
                  orientation="bottom"
                  fontSize={12}
                  stroke={SERIES.bookings}
                />
                <XAxis
                  xAxisId="revenue"
                  type="number"
                  orientation="top"
                  fontSize={12}
                  stroke={SERIES.revenue}
                  tickFormatter={(v) => formatCompact(Number(v))}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={120}
                  fontSize={12}
                />
                <Tooltip
                  formatter={(v, name) => [
                    name === "Revenue"
                      ? formatCurrency(Number(v) * 100)
                      : Number(v),
                    name,
                  ]}
                />
                <Legend />
                <Bar
                  xAxisId="bookings"
                  dataKey="bookings"
                  fill={SERIES.bookings}
                  name="Bookings"
                />
                <Bar
                  xAxisId="revenue"
                  dataKey="revenue"
                  fill={SERIES.revenue}
                  name="Revenue"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="No service data for this period" />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Bottom axis: bookings. Top axis: revenue.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-4 text-lg font-semibold">{t("analyticsCharts.utilizationTitle")}</h3>
          {utilizationData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={utilizationData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  fontSize={12}
                />
                <Tooltip formatter={(v) => [`${v}%`, "Utilization"]} />
                <Bar
                  dataKey="utilization"
                  fill={SERIES.revenue}
                  name="Utilization"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="No utilization data for this period" />
          )}
        </div>
      </div>
    </>
  );
}
