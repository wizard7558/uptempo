"use client";

import { useState } from "react";
import { getRevenueReport, type RevenueReport } from "@/actions/revenue";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  startOfWeek,
  startOfMonth,
  endOfMonth,
  subDays,
  startOfYear,
  endOfYear,
  format,
} from "date-fns";
import { useT } from "@/lib/terms/client";

interface RevenueDashboardProps {
  initialData: RevenueReport;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

type QuickFilter = "this_week" | "this_month" | "last_30" | "this_year";

export function RevenueDashboard({ initialData }: RevenueDashboardProps) {
  const t = useT("reports");
  const now = new Date();
  const [report, setReport] = useState<RevenueReport>(initialData);
  const data = report.staff;
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

  async function fetchData(start: Date, end: Date) {
    setLoading(true);
    try {
      const result = await getRevenueReport({ start, end });
      setReport(result);
    } catch (err) {
      // Surface the failure instead of silently leaving stale (e.g. this-month)
      // data on screen, which reads as "the date filter doesn't work".
      console.error("[Revenue] Failed to load revenue for range:", err);
      toast.error("Couldn't load revenue for that range. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleApply() {
    setActiveFilter(null);
    // Parse both inputs as local day boundaries so the range matches what the
    // user picked (new Date("yyyy-MM-dd") alone is parsed as UTC midnight).
    fetchData(
      new Date(startDate + "T00:00:00"),
      new Date(endDate + "T23:59:59"),
    );
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

  // Calculate summary stats
  const totalRevenue = data.reduce((sum, d) => sum + d.totalCents, 0);
  const totalTips = data.reduce((sum, d) => sum + d.tipsCents, 0);
  const totalService = data.reduce((sum, d) => sum + d.serviceCents, 0);
  const totalFees = data.reduce((sum, d) => sum + d.platformFeeCents, 0);
  const totalNet = data.reduce((sum, d) => sum + d.netCents, 0);
  const totalServices = data.reduce((sum, d) => sum + d.chargeCount, 0);
  const hasFees = data.some((d) => d.platformFeeCents > 0);
  const hasTips = data.some((d) => d.tipsCents > 0);

  // Sort by revenue descending
  const sorted = [...data].sort((a, b) => b.totalCents - a.totalCents);

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

      {/* Summary cards */}
      {hasFees ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Gross Revenue</p>
            <p className="text-2xl font-bold">{formatPrice(totalRevenue)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Platform Fees</p>
            <p className="text-2xl font-bold text-muted-foreground">
              {formatPrice(totalFees)}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Net Payout</p>
            <p className="text-2xl font-bold text-green-600">
              {formatPrice(totalNet)}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t("revenueDashboard.paidBookings")}</p>
            <p className="text-2xl font-bold">{totalServices}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold">{formatPrice(totalRevenue)}</p>
          </div>
          {hasTips ? (
            <>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t("revenueDashboard.servicesCard")}</p>
                <p className="text-2xl font-bold">{formatPrice(totalService)}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Tips</p>
                <p className="text-2xl font-bold">{formatPrice(totalTips)}</p>
              </div>
            </>
          ) : null}
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t("revenueDashboard.paidBookings")}</p>
            <p className="text-2xl font-bold">{totalServices}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{t("revenueDashboard.avgPerBooking")}</p>
            <p className="text-2xl font-bold">
              {formatPrice(
                totalServices > 0 ? totalRevenue / totalServices : 0,
              )}
            </p>
          </div>
        </div>
      )}

      {report.retail ? (
        <div className="rounded-lg border bg-card p-4 sm:max-w-xs">
          <p className="text-sm text-muted-foreground">
            {t("revenueDashboard.retailTitle")}
          </p>
          <p className="text-2xl font-bold">
            {formatPrice(report.retail.salesCents)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("revenueDashboard.retailOrders", {
              count: report.retail.orderCount,
            })}
          </p>
        </div>
      ) : null}

      {/* Per-staff breakdown table */}
      {sorted.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            No revenue data for this period. Revenue appears here when
            appointments are completed through checkout.
          </p>
        </div>
      ) : hasFees ? (
        <div className="rounded-md border">
          {/* Header row with fee columns */}
          <div className="grid grid-cols-[1fr_72px_88px_88px_88px_88px_88px] gap-2 border-b bg-muted/50 px-4 py-3 text-xs font-medium text-muted-foreground">
            <div>{t("revenueDashboard.staffColumn")}</div>
            <div>{t("revenueDashboard.bookingsColumn")}</div>
            <div>Gross</div>
            <div>Tips</div>
            <div>Fees</div>
            <div>Net</div>
            <div>Avg / Svc</div>
          </div>

          {/* Data rows */}
          {sorted.map((row) => {
            const avg =
              row.chargeCount > 0 ? row.netCents / row.chargeCount : 0;
            return (
              <div
                key={row.staffId}
                className="grid grid-cols-[1fr_72px_88px_88px_88px_88px_88px] gap-2 border-b px-4 py-3 text-sm items-center last:border-b-0"
              >
                <div className="font-medium truncate">{row.staffName}</div>
                <div>{row.chargeCount}</div>
                <div className="font-medium">{formatPrice(row.totalCents)}</div>
                <div className="text-muted-foreground">
                  {formatPrice(row.tipsCents)}
                </div>
                <div className="text-muted-foreground">
                  {formatPrice(row.platformFeeCents)}
                </div>
                <div className="font-medium text-green-600">
                  {formatPrice(row.netCents)}
                </div>
                <div className="text-muted-foreground">{formatPrice(avg)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-md border">
          {/* Header row without fee columns */}
          <div
            className={`grid gap-2 border-b bg-muted/50 px-4 py-3 text-xs font-medium text-muted-foreground ${
              hasTips
                ? "grid-cols-[1fr_56px_80px_80px_80px_80px]"
                : "grid-cols-[1fr_120px_120px_120px]"
            }`}
          >
            <div>{t("revenueDashboard.staffColumn")}</div>
            <div className="text-right">#</div>
            <div className="text-right">Total</div>
            {hasTips ? (
              <>
                <div className="text-right">Service</div>
                <div className="text-right">Tips</div>
              </>
            ) : null}
            <div className="text-right">Avg</div>
          </div>

          {/* Data rows */}
          {sorted.map((row) => {
            const avg =
              row.chargeCount > 0 ? row.totalCents / row.chargeCount : 0;
            return (
              <div
                key={row.staffId}
                className={`grid gap-2 border-b px-4 py-3 text-sm items-center last:border-b-0 ${
                  hasTips
                    ? "grid-cols-[1fr_56px_80px_80px_80px_80px]"
                    : "grid-cols-[1fr_120px_120px_120px]"
                }`}
              >
                <div className="font-medium truncate">{row.staffName}</div>
                <div className="text-right">{row.chargeCount}</div>
                <div className="font-medium text-right">
                  {formatPrice(row.totalCents)}
                </div>
                {hasTips ? (
                  <>
                    <div className="text-muted-foreground text-right">
                      {formatPrice(row.serviceCents)}
                    </div>
                    <div className="text-muted-foreground text-right">
                      {formatPrice(row.tipsCents)}
                    </div>
                  </>
                ) : null}
                <div className="text-muted-foreground text-right">
                  {formatPrice(avg)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
