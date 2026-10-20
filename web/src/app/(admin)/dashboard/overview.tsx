import { redirect } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { CalendarDays, Gauge, TrendingUp, TriangleAlert } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { getUserRole } from "@/lib/auth/rbac";
import { hasPermission } from "@/lib/auth/permissions";
import { getTenantSlug } from "@/lib/tenant/context";
import { getDashboardData } from "@/actions/dashboard";
import { getUnreadAlertCountForTenant, listAlertsForTenant, type AlertView } from "@/lib/alerts/for-tenant";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import {
  deltaArrow,
  firstNameOf,
  formatDollars,
  formatPercentPoints,
  formatSignedDollars,
  formatUnitMagnitude,
  greetingForHour,
  kpiTone,
  zonedHour,
  type Tone,
} from "@/lib/dashboard/view";
import { RevenueChart } from "./revenue-chart";
import { GoalDialog } from "./goal-dialog";

export const dynamic = "force-dynamic";

const toneClass: Record<Tone, string> = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "gap-0 rounded-xl border-border/80 p-6 shadow-none",
        className,
      )}
    >
      {children}
    </Card>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

function PillLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-medium uppercase tracking-[0.18em] text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {children}
      <span aria-hidden>→</span>
    </Link>
  );
}

function QuietLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="editorial-link text-xs">
      {children}
      <span aria-hidden className="ml-1">
        →
      </span>
    </Link>
  );
}

/** Ring gauge for the business score — pure SVG arc, no chart library. */
function ScoreRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="relative size-[132px] shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth="8"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-light leading-none">
          {clamped}
        </span>
        <span className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
          / 100
        </span>
      </div>
    </div>
  );
}

async function loadTasks(
  slug: string | null,
): Promise<{ alerts: AlertView[]; unread: number }> {
  if (!slug) return { alerts: [], unread: 0 };
  try {
    const [alerts, unread] = await Promise.all([
      listAlertsForTenant(slug),
      getUnreadAlertCountForTenant(slug),
    ]);
    return { alerts, unread };
  } catch (error) {
    console.error("[Dashboard] failed to load tasks:", error);
    return { alerts: [], unread: 0 };
  }
}

export async function DashboardOverview() {
  const role = await getUserRole();
  if (!role || !hasPermission(role, "view_revenue")) {
    redirect("/schedule");
  }
  const canManageSettings = hasPermission(role, "manage_settings");

  const [session, slug] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    getTenantSlug(),
  ]);

  const [data, tasks] = await Promise.all([getDashboardData(), loadTasks(slug)]);

  const {
    timezone,
    monthRevenueCents,
    revenueDeltaCents,
    goalCents,
    goalProgressRatio,
    dailyRevenueSeries,
    todaysAppointments,
    kpis,
    insights,
    recommendation,
    businessScore,
  } = data;

  const now = new Date();
  const nowInBusinessTz = new TZDate(now, timezone);
  const greeting = greetingForHour(zonedHour(now, timezone));
  const firstName = firstNameOf(session?.user?.name);
  const monthName = format(nowInBusinessTz, "MMMM");

  const kpiTiles = [
    {
      label: "Booked Out",
      value: kpis.bookedOutWeeks.value.toFixed(1),
      unit: "Weeks",
      delta: kpis.bookedOutWeeks.delta,
      magnitude: formatUnitMagnitude(kpis.bookedOutWeeks.delta),
      higherIsBetter: true,
    },
    {
      label: "Avg. Ticket",
      value: formatDollars(kpis.avgTicketCents.value),
      unit: null,
      delta: kpis.avgTicketCents.delta,
      magnitude: formatDollars(Math.abs(kpis.avgTicketCents.delta)),
      higherIsBetter: true,
    },
    {
      label: "Rebook Rate",
      value: formatPercent(kpis.rebookRate.value),
      unit: null,
      delta: kpis.rebookRate.delta,
      magnitude: formatPercentPoints(kpis.rebookRate.delta),
      higherIsBetter: true,
    },
    {
      label: "Retail Sales",
      value: formatDollars(kpis.retailSalesCents.value),
      unit: null,
      delta: kpis.retailSalesCents.delta,
      magnitude: formatDollars(Math.abs(kpis.retailSalesCents.delta)),
      higherIsBetter: true,
    },
    {
      label: "Cancellation Rate",
      value: formatPercent(kpis.cancellationRate.value),
      unit: null,
      delta: kpis.cancellationRate.delta,
      magnitude: formatPercentPoints(kpis.cancellationRate.delta),
      higherIsBetter: false,
    },
  ];

  const insightCards: {
    key: string;
    label: string;
    body: React.ReactNode;
    href: string;
    linkText: string;
  }[] = [];

  insightCards.push({
    key: "capacity",
    label: "Capacity",
    body: (
      <>
        {insights.capacityStatus.label}
        <span className="text-muted-foreground">
          {" "}
          · {insights.capacityStatus.utilizationPercent}% booked
        </span>
      </>
    ),
    href: "/services",
    linkText:
      insights.capacityStatus.label === "At capacity"
        ? "Raise your rates"
        : "Manage services",
  });

  if (insights.topService) {
    insightCards.push({
      key: "top-service",
      label: "Top Service",
      body: (
        <>
          {insights.topService.serviceName}
          <span className="text-muted-foreground">
            {" "}
            · {formatPercent(insights.topService.revenueShareRatio)} of revenue
          </span>
        </>
      ),
      href: "/analytics/services",
      linkText: "View breakdown",
    });
  }

  if (insights.lowRoiService) {
    insightCards.push({
      key: "low-roi",
      label: "Watch",
      body: (
        <>
          {insights.lowRoiService.serviceName}
          <span className="text-muted-foreground">
            {" "}
            · {formatPercent(insights.lowRoiService.timeShareRatio)} of time,{" "}
            {formatPercent(insights.lowRoiService.revenueShareRatio)} of revenue
          </span>
        </>
      ),
      href: "/analytics/services",
      linkText: "See what to do",
    });
  }

  const visibleTasks = tasks.alerts.slice(0, 4);

  return (
    <div className="space-y-8 p-6">
      {/* Greeting */}
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-light tracking-tight sm:text-4xl">
          {greeting}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <Eyebrow>Here&apos;s how your business is doing today</Eyebrow>
      </header>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 xl:col-span-2">
          {/* Row 1: business score + revenue */}
          <div className="grid gap-6 md:grid-cols-2">
            <Panel className="items-start gap-5">
              <Eyebrow>Business Score</Eyebrow>
              <div className="mt-4 flex items-center gap-5">
                <ScoreRing score={businessScore.score} />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {businessScore.coachingMessage}
                </p>
              </div>
              <div className="mt-5">
                <PillLink href="/analytics/services">View Full Breakdown</PillLink>
              </div>
            </Panel>

            <Panel>
              <div className="flex items-start justify-between gap-3">
                <Eyebrow>Monthly Revenue</Eyebrow>
                {canManageSettings ? (
                  <GoalDialog currentGoalCents={goalCents} />
                ) : null}
              </div>
              <p className="mt-4 font-display text-4xl font-light tracking-tight">
                {formatDollars(monthRevenueCents)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{monthName}</p>
              <div className="mt-2 space-y-0.5 text-sm">
                {goalCents != null && goalProgressRatio != null ? (
                  <p>
                    {Math.round(goalProgressRatio * 100)}% of{" "}
                    {formatDollars(goalCents)} goal
                  </p>
                ) : null}
                <p
                  className={cn(
                    revenueDeltaCents >= 0
                      ? "text-success"
                      : "text-destructive",
                  )}
                >
                  {formatSignedDollars(revenueDeltaCents)} vs last month
                </p>
              </div>
              <div className="mt-4">
                <RevenueChart series={dailyRevenueSeries} />
              </div>
            </Panel>
          </div>

          {/* Row 2: recommendation (or capacity fallback) */}
          {recommendation ? (
            <Panel>
              <div className="flex size-11 items-center justify-center rounded-full border border-border/80">
                <TrendingUp className="size-5" strokeWidth={1.5} />
              </div>
              <div className="mt-4">
                <Eyebrow>Today&apos;s Recommendation</Eyebrow>
              </div>
              <h2 className="mt-2 font-display text-2xl font-light tracking-tight">
                {recommendation.title}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-border/80 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {recommendation.impactLabel}
                </span>
                {recommendation.estimatedAnnualImpactCents != null ? (
                  <span className="text-sm">
                    <span className="eyebrow">Est. Annual Impact</span>{" "}
                    <span className="font-medium text-success">
                      +{formatDollars(recommendation.estimatedAnnualImpactCents)}
                    </span>
                  </span>
                ) : null}
              </div>
              <div className="mt-5">
                <PillLink href="/analytics/services">See Full Analysis</PillLink>
              </div>
            </Panel>
          ) : (
            <Panel>
              <div className="flex size-11 items-center justify-center rounded-full border border-border/80">
                <Gauge className="size-5" strokeWidth={1.5} />
              </div>
              <div className="mt-4">
                <Eyebrow>Capacity</Eyebrow>
              </div>
              <h2 className="mt-2 font-display text-2xl font-light tracking-tight">
                {insights.capacityStatus.label}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your calendar is {insights.capacityStatus.utilizationPercent}%
                booked this month.
              </p>
            </Panel>
          )}

          {/* Row 3: KPI strip */}
          <Panel className="p-0">
            <div className="grid grid-cols-2 divide-y divide-border/80 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
              {kpiTiles.map((tile) => {
                const tone = kpiTone(tile.delta, {
                  higherIsBetter: tile.higherIsBetter,
                });
                return (
                  <div key={tile.label} className="space-y-2 p-5">
                    <Eyebrow>{tile.label}</Eyebrow>
                    <p className="font-display text-3xl font-light tracking-tight">
                      {tile.value}
                      {tile.unit ? (
                        <span className="ml-1 text-sm text-muted-foreground">
                          {tile.unit}
                        </span>
                      ) : null}
                    </p>
                    <p className={cn("text-xs", toneClass[tone])}>
                      {tile.delta === 0 ? (
                        "No change vs last month"
                      ) : (
                        <>
                          {deltaArrow(tile.delta)} {tile.magnitude} vs last month
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          </Panel>

          {/* Row 4: insights */}
          <div className="space-y-4">
            <Eyebrow>Insights</Eyebrow>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {insightCards.map((card) => (
                <Panel key={card.key} className="gap-3">
                  <Eyebrow>{card.label}</Eyebrow>
                  <p className="mt-3 text-sm leading-relaxed">{card.body}</p>
                  <div className="mt-4">
                    <QuietLink href={card.href}>{card.linkText}</QuietLink>
                  </div>
                </Panel>
              ))}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          {/* Today's schedule */}
          <Panel>
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4" strokeWidth={1.5} />
              <Eyebrow>Today&apos;s Schedule</Eyebrow>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {format(nowInBusinessTz, "EEEE, MMMM d")}
            </p>
            <div className="mt-4 space-y-4">
              {todaysAppointments.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  No appointments today.
                </p>
              ) : (
                todaysAppointments.map((appt) => (
                  <div key={appt.id} className="flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/80 text-xs font-medium text-muted-foreground">
                      {appt.staffInitials}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {appt.serviceNames.length > 0
                          ? appt.serviceNames.join(", ")
                          : "Appointment"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {appt.clientName}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {format(new TZDate(new Date(appt.time), timezone), "h:mm a")}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="mt-5">
              <QuietLink href="/schedule">View full calendar</QuietLink>
            </div>
          </Panel>

          {/* Tasks */}
          <Panel>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Tasks</h2>
              {tasks.unread > 0 ? (
                <span className="flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground">
                  {tasks.unread > 9 ? "9+" : tasks.unread}
                </span>
              ) : null}
            </div>
            <div className="mt-4 space-y-4">
              {visibleTasks.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">
                  You&apos;re all caught up.
                </p>
              ) : (
                visibleTasks.map((alert) => (
                  <div key={alert.id} className="flex gap-3">
                    {alert.severity === "warning" ? (
                      <TriangleAlert
                        className="mt-0.5 size-4 shrink-0 text-amber-600"
                        strokeWidth={1.5}
                      />
                    ) : (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm leading-snug",
                          alert.severity === "warning" && "font-medium",
                        )}
                      >
                        {alert.title}
                      </p>
                      <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                        {alert.severity}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
