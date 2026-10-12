"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatPercent } from "@/components/ui/chart-utils";
import { useT } from "@/lib/terms/client";
import type {
  ServiceAnalytics,
  ServiceMetricsRow,
} from "@/lib/analytics/service-metrics";

const DASH = "—";

const LEGEND_KEYS = [
  "legendBookings",
  "legendRevenue",
  "legendAvgTicket",
  "legendHours",
  "legendRebook",
  "legendNoShows",
  "legendNewReturning",
] as const;

export function ServiceAnalyticsSection({ data }: { data: ServiceAnalytics }) {
  const t = useT("reports");
  const s = (key: string) => t(`serviceAnalytics.${key}`);

  const pct = (v: number | null) => (v == null ? DASH : formatPercent(v));
  const noShows = (r: ServiceMetricsRow) =>
    r.bookings === 0 ? DASH : `${r.noShows} (${pct(r.noShowRate)})`;
  const newReturning = (r: ServiceMetricsRow) =>
    `${r.newClients} / ${r.returningClients}`;
  const maxRevenue = Math.max(1, data.totals.revenueCents);

  function Card({
    title,
    nameLabel,
    rows,
  }: {
    title: string;
    nameLabel: string;
    rows: ServiceMetricsRow[];
  }) {
    return (
      <div className="rounded-xl border p-4">
        <h3 className="mb-3 font-medium">{title}</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{nameLabel}</TableHead>
                <TableHead className="text-right">{s("bookings")}</TableHead>
                <TableHead className="text-right">{s("revenue")}</TableHead>
                <TableHead className="text-right">{s("avgTicket")}</TableHead>
                <TableHead className="text-right">{s("hours")}</TableHead>
                <TableHead className="text-right">{s("rebook")}</TableHead>
                <TableHead className="text-right">{s("noShows")}</TableHead>
                <TableHead className="text-right">{s("newReturning")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-sm text-muted-foreground"
                  >
                    {s("empty")}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => {
                  const share = (r.revenueCents / maxRevenue) * 100;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-right">{r.bookings}</TableCell>
                      <TableCell className="text-right">
                        <div className="font-medium">
                          {formatCurrency(r.revenueCents)}
                        </div>
                        <div
                          aria-hidden
                          className="ml-auto h-1 rounded bg-foreground/20"
                          style={{ width: `${share}%` }}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {r.avgTicketCents == null
                          ? DASH
                          : formatCurrency(r.avgTicketCents)}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.hoursBooked.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right">
                        {pct(r.rebookRate)}
                      </TableCell>
                      <TableCell className="text-right">{noShows(r)}</TableCell>
                      <TableCell className="text-right">
                        {newReturning(r)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">{s("total")}</TableCell>
                <TableCell className="text-right">
                  {data.totals.bookings}
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(data.totals.revenueCents)}
                </TableCell>
                <TableCell className="text-right">
                  {data.totals.avgTicketCents == null
                    ? DASH
                    : formatCurrency(data.totals.avgTicketCents)}
                </TableCell>
                <TableCell className="text-right">
                  {data.totals.hoursBooked.toFixed(1)}
                </TableCell>
                <TableCell className="text-right">
                  {pct(data.totals.rebookRate)}
                </TableCell>
                <TableCell className="text-right">
                  {noShows(data.totals)}
                </TableCell>
                <TableCell className="text-right">
                  {newReturning(data.totals)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{s("title")}</h2>
        <p className="text-sm text-muted-foreground">{s("subtitle")}</p>
      </div>
      <Card
        title={s("byService")}
        nameLabel={s("nameService")}
        rows={data.byService}
      />
      <Card
        title={s("byStaff")}
        nameLabel={s("nameStaff")}
        rows={data.byStaff}
      />
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          {s("legendTitle")}
        </p>
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {LEGEND_KEYS.map((k) => (
            <li key={k}>{s(k)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
