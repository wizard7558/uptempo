import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/permissions";
import { requireModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { addDays, localDay } from "@/lib/scheduling/intervals";
import { listClassWeek } from "@/actions/classes";
import { listServices } from "@/actions/services";
import { listStaff } from "@/actions/staff";
import { listActiveLocations } from "@/actions/locations";
import { formatTimeRange, formatWeekRange, groupByDay, resolveWeek } from "@/lib/classes/week";
import { Button } from "@/components/ui/button";
import { AddClassSheet } from "./add-class-sheet";

export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireModule("classes");
  const { role } = await requireRole("owner", "admin", "provider", "assistant");
  requirePermission(role, "manage_schedule");
  const { week } = await searchParams;

  const slug = await getTenantSlug();
  const { timezone } = await loadSchedulingSettings(slug);
  const today = localDay(new Date(), timezone);
  const weekStart = resolveWeek(week, today);
  const canAdd = role === "owner" || role === "admin";

  const [t, sessions, services, staff, locations] = await Promise.all([
    getT("classes", slug),
    listClassWeek(weekStart),
    canAdd ? listServices() : Promise.resolve([]),
    canAdd ? listStaff() : Promise.resolve([]),
    canAdd ? listActiveLocations() : Promise.resolve([]),
  ]);
  const groups = groupByDay(sessions, timezone);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {canAdd && (
          <AddClassSheet
            services={services
              .filter((s) => s.isClass === 1)
              .map((s) => ({ id: s.id, name: s.name, classCapacity: s.classCapacity }))}
            staff={staff.map((s) => ({ id: s.id, name: s.displayName }))}
            locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          />
        )}
      </div>

      <nav aria-label={t("weekLabel", { range: formatWeekRange(weekStart) })} className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" className="h-11">
          <Link href={`/classes?week=${addDays(weekStart, -7)}`}>{t("prevWeek")}</Link>
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link href="/classes">{t("thisWeek")}</Link>
        </Button>
        <Button asChild variant="outline" className="h-11">
          <Link href={`/classes?week=${addDays(weekStart, 7)}`}>{t("nextWeek")}</Link>
        </Button>
        <p className="font-medium">{t("weekLabel", { range: formatWeekRange(weekStart) })}</p>
      </nav>

      {groups.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.day} className="space-y-2">
              <h2 className="text-lg font-semibold">{g.label}</h2>
              <ul className="divide-y rounded-lg border">
                {g.sessions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="space-y-0.5">
                      <p className="font-medium">
                        {formatTimeRange(s.start, s.end, timezone)} - {s.className}
                      </p>
                      <p className="text-sm text-muted-foreground">{t("public.with", { staff: s.staffName })}</p>
                      <p className="text-sm">
                        {t("bookedOf", { booked: s.booked, capacity: s.capacity })}
                        {s.waitlisted > 0 && <> - {t("waitlistCount", { count: s.waitlisted })}</>}
                        {" - "}
                        {t(`statuses.${s.status}`)}
                      </p>
                    </div>
                    <Button asChild variant="outline" className="h-11">
                      <Link href={`/classes/${s.id}`}>{t("open")}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
