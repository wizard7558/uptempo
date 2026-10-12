"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import {
  formatCurrency,
  formatPercent,
} from "@/components/ui/chart-utils";
import { getAnalyticsDashboard } from "@/actions/analytics";
import { autoGranularity } from "@/lib/analytics/granularity";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  startOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  startOfYear,
  endOfYear,
  format,
} from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/terms/client";
import { ServiceAnalyticsSection } from "./service-analytics-section";

const AnalyticsCharts = dynamic(
  () =>
    import("./analytics-charts").then((module) => ({
      default: module.AnalyticsCharts,
    })),
  {
    loading: () => (
      <div className="space-y-6">
        <Skeleton className="h-72 rounded-lg" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    ),
  },
);

type QuickFilter = "this_week" | "this_month" | "last_30" | "this_year";
type GranularityOption = "auto" | "day" | "week" | "month";

interface AnalyticsDashboardProps {
  initialData: Awaited<ReturnType<typeof getAnalyticsDashboard>>;
}

export function AnalyticsDashboard({ initialData }: AnalyticsDashboardProps) {
  const t = useT("reports");
  const now = new Date();
  const [data, setData] =
    useState<Awaited<ReturnType<typeof getAnalyticsDashboard>>>(initialData);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(
    format(startOfMonth(now), "yyyy-MM-dd"),
  );
  const [endDate, setEndDate] = useState(
    format(endOfMonth(now), "yyyy-MM-dd"),
  );
  const [activeFilter, setActiveFilter] = useState<QuickFilter | null>(
    "this_month",
  );
  const [granularity, setGranularity] = useState<GranularityOption>("auto");

  async function fetchData(
    start: Date,
    end: Date,
    gran: GranularityOption = granularity,
  ) {
    setLoading(true);
    try {
      const resolved = gran === "auto" ? autoGranularity({ start, end }) : gran;
      const result = await getAnalyticsDashboard({ start, end }, resolved);
      setData(result);
    } catch {
      // Keep current data on error
    } finally {
      setLoading(false);
    }
  }

  // Reconstruct the currently-applied range from the date inputs (matches how
  // handleApply parses them) so a granularity change can refetch the same range.
  function currentRange(): { start: Date; end: Date } {
    return {
      start: new Date(startDate + "T00:00:00"),
      end: new Date(endDate + "T23:59:59"),
    };
  }

  function handleApply() {
    setActiveFilter(null);
    const { start, end } = currentRange();
    fetchData(start, end);
  }

  function handleGranularityChange(gran: GranularityOption) {
    setGranularity(gran);
    const { start, end } = currentRange();
    fetchData(start, end, gran);
  }

  function handleQuickFilter(filter: QuickFilter) {
    setActiveFilter(filter);
    let start: Date;
    let end: Date;

    switch (filter) {
      case "this_week":
        start = startOfWeek(now, { weekStartsOn: 1 });
        end = now;
        break;
      case "this_month":
        start = startOfMonth(now);
        end = endOfMonth(now);
        break;
      case "last_30":
        start = subDays(now, 30);
        end = now;
        break;
      case "this_year":
        start = startOfYear(now);
        end = endOfYear(now);
        break;
    }

    setStartDate(format(start, "yyyy-MM-dd"));
    setEndDate(format(end, "yyyy-MM-dd"));
    fetchData(start, end);
  }

  // No-show rate color
  const noShowColor =
    data.bookingMetrics.noShowRate > 0.1
      ? "text-red-600"
      : data.bookingMetrics.noShowRate < 0.05
        ? "text-green-600"
        : "";
  const summary = data.expenseRevenueSummary;
  // Only show service categories that have any activity or cost.
  const serviceRows = summary.revenueByCategory.filter(
    (r) =>
      r.totalCents > 0 ||
      r.bookings > 0 ||
      r.serviceCostCents > 0 ||
      r.mappedExpenseCents > 0,
  );

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "this_week", label: "This Week" },
              { key: "this_month", label: "This Month" },
              { key: "last_30", label: "Last 30 Days" },
              { key: "this_year", label: "This Year" },
            ] as const
          ).map(({ key, label }) => (
            <Button
              key={key}
              variant={activeFilter === key ? "default" : "outline"}
              
              onClick={() => handleQuickFilter(key)}
              disabled={loading}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setActiveFilter(null);
            }}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setActiveFilter(null);
            }}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
          <Button  onClick={handleApply} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Apply"
            )}
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">Total Revenue</p>
          <p className="text-2xl font-bold">
            {formatCurrency(summary.totalRevenueCents)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("analyticsPage.bookingsCard")}</p>
          <p className="text-2xl font-bold">{data.bookingMetrics.total}</p>
          <p className="text-xs text-muted-foreground">
            {data.bookingMetrics.completed} completed
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">No-Show Rate</p>
          <p className={`text-2xl font-bold ${noShowColor}`}>
            {formatPercent(data.bookingMetrics.noShowRate)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">{t("analyticsPage.clientMixCard")}</p>
          <p className="text-2xl font-bold">
            {data.clientRetention.newClients} new /{" "}
            {data.clientRetention.returningClients} returning
          </p>
          <p className="text-xs text-muted-foreground">
            {formatPercent(data.clientRetention.retentionRate)} retention
          </p>
        </div>
      </div>

      <ServiceAnalyticsSection data={data.serviceAnalytics} />

      <div className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Revenue vs Expenses</h2>
          <p className="text-sm text-muted-foreground">
            Compare completed service revenue against tracked expenses for the selected date range.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-sm text-muted-foreground">Service Revenue</p>
            <p className="mt-2 text-2xl font-semibold">
              {formatCurrency(summary.totalRevenueCents)}
            </p>
          </div>
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-sm text-muted-foreground">Est. service COGS</p>
            <p className="mt-2 text-2xl font-semibold">
              {formatCurrency(summary.totalServiceCostCents)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sum of per-service costs on completed, charged visits (see Services).
            </p>
          </div>
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-sm text-muted-foreground">Gross margin (after COGS)</p>
            <p
              className={`mt-2 text-2xl font-semibold ${
                summary.grossMarginCents < 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              {formatCurrency(summary.grossMarginCents)}
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-sm text-muted-foreground">Operating expenses</p>
            <p className="mt-2 text-2xl font-semibold">
              {formatCurrency(summary.totalExpenseCents)}
            </p>
          </div>
          <div className="rounded-xl border bg-background/70 p-4">
            <p className="text-sm text-muted-foreground">Net (revenue − expenses)</p>
            <p
              className={`mt-2 text-2xl font-semibold ${
                summary.netCents < 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              {formatCurrency(summary.netCents)}
            </p>
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="mb-3">
            <h3 className="font-medium">{t("analyticsPage.revenueByCategoryTitle")}</h3>
            <p className="text-sm text-muted-foreground">
              Completed appointments and booked service values, with efficiency
              and return on cost.
            </p>
          </div>
          {serviceRows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 pr-3 text-left font-medium">
                      {t("analyticsPage.categoryColumn")}
                    </th>
                    <th className="py-2 px-3 text-right font-medium">Revenue</th>
                    <th className="py-2 px-3 text-right font-medium">Bookings</th>
                    <th className="py-2 px-3 text-right font-medium">
                      $ / booking
                    </th>
                    <th className="py-2 px-3 text-right font-medium">$ / min</th>
                    <th className="py-2 px-3 text-right font-medium">Cost</th>
                    <th className="py-2 pl-3 text-right font-medium">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceRows.map((row) => {
                    const cost = row.serviceCostCents + row.mappedExpenseCents;
                    const perBooking =
                      row.bookings > 0
                        ? Math.round(row.totalCents / row.bookings)
                        : 0;
                    const perMin =
                      row.totalMinutes > 0
                        ? Math.round(row.totalCents / row.totalMinutes)
                        : 0;
                    const ret = cost > 0 ? row.totalCents / cost : null;
                    return (
                      <tr key={row.category} className="border-b last:border-0">
                        <td className="py-2 pr-3 text-left">{row.label}</td>
                        <td className="py-2 px-3 text-right font-medium">
                          {formatCurrency(row.totalCents)}
                        </td>
                        <td className="py-2 px-3 text-right">{row.bookings}</td>
                        <td className="py-2 px-3 text-right text-muted-foreground">
                          {row.bookings > 0 ? formatCurrency(perBooking) : "—"}
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">
                          {row.totalMinutes > 0 ? formatCurrency(perMin) : "—"}
                        </td>
                        <td className="py-2 px-3 text-right text-muted-foreground">
                          {cost > 0 ? formatCurrency(cost) : "—"}
                        </td>
                        <td className="py-2 pl-3 text-right font-medium">
                          {ret != null ? `${ret.toFixed(1)}×` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No completed service revenue in this period.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {t("analyticsPage.costFootnote")}
          </p>
        </div>

        <div className="rounded-xl border p-4">
          <div className="mb-3">
            <h3 className="font-medium">Expenses by Category</h3>
            <p className="text-sm text-muted-foreground">
              {t("analyticsPage.expensesByCategoryHint")}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {summary.expenseByCategory.map((row) => (
              <div
                key={row.category}
                className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium">
                  {formatCurrency(row.totalCents)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <AnalyticsCharts
        data={data}
        granularity={granularity}
        onGranularityChange={handleGranularityChange}
        disabled={loading}
      />
    </div>
  );
}
