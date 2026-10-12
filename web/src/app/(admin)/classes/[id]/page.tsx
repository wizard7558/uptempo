import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/permissions";
import { requireModule } from "@/lib/tenant/modules";
import { getTenantSlug } from "@/lib/tenant/context";
import { getT } from "@/lib/terms/server";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { localDay } from "@/lib/scheduling/intervals";
import { getRoster } from "@/actions/classes";
import { formatDayLabel, formatTimeRange } from "@/lib/classes/week";
import { Button } from "@/components/ui/button";
import { RosterView } from "./roster-view";

export default async function ClassRosterPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule("classes");
  const { role } = await requireRole("owner", "admin", "provider", "assistant");
  requirePermission(role, "manage_schedule");
  const { id } = await params;

  const slug = await getTenantSlug();
  const [t, res, { timezone }] = await Promise.all([getT("classes", slug), getRoster(id), loadSchedulingSettings(slug)]);
  if (!res.success) notFound();
  const { session, booked, waitlist } = res.roster;

  return (
    <>
      <div className="mx-auto max-w-3xl px-6 pt-6">
        <Button asChild variant="outline" className="h-11">
          <Link href="/classes">{t("backToClasses")}</Link>
        </Button>
      </div>
      <RosterView
        session={{
          id: session.id,
          className: session.className,
          staffName: session.staffName,
          whenLabel: `${formatDayLabel(localDay(session.start, timezone))}, ${formatTimeRange(session.start, session.end, timezone)}`,
          booked: session.booked,
          capacity: session.capacity,
          status: session.status,
        }}
        booked={booked}
        waitlist={waitlist}
        canAdmin={role === "owner" || role === "admin"}
      />
    </>
  );
}
