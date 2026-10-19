import Link from "next/link";
import { getT } from "@/lib/terms/server";
import { AlertTriangle } from "lucide-react";
import {
  getLocationCoverageGaps,
  listLocations,
} from "@/actions/locations";
import { listStaff } from "@/actions/staff";
import {
  getWorkingHoursForStaffMember,
  listAvailabilityOverrides,
  type AvailabilityOverrideRow,
} from "@/actions/working-hours";
import { WorkingHoursPageClient } from "./client";

export default async function WorkingHoursPage() {
  const t = await getT("settings");
  const [staff, locations, gaps] = await Promise.all([
    listStaff(),
    listLocations(),
    getLocationCoverageGaps(),
  ]);

  // Pre-load hours for the first staff member (if any)
  let initialHours: Awaited<ReturnType<typeof getWorkingHoursForStaffMember>> = [];
  let initialOverrides: AvailabilityOverrideRow[] = [];
  if (staff.length > 0) {
    [initialHours, initialOverrides] = await Promise.all([
      getWorkingHoursForStaffMember(staff[0].id),
      listAvailabilityOverrides(staff[0].id),
    ]);
  }

  // Build a lookup of which locations each staff member is missing.
  const gapsByStaffMember = new Map<string, string[]>();
  for (const gap of gaps) {
    const list = gapsByStaffMember.get(gap.staffId) ?? [];
    list.push(gap.locationName);
    gapsByStaffMember.set(gap.staffId, list);
  }
  const missingByStaffId: Record<string, string[]> = Object.fromEntries(
    gapsByStaffMember,
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Working Hours</h1>
        <p className="text-muted-foreground mt-1">
          {t("hoursPage.subtitle")}
        </p>
      </div>

      {gaps.length > 0 && (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700/50 dark:bg-amber-950/20">
          <AlertTriangle className="size-5 shrink-0 text-amber-600" />
          <div className="space-y-1.5">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {t("hoursPage.gapTitle")}
            </p>
            <p className="text-amber-900/90 dark:text-amber-200/90">
              {t("hoursPage.gapBody")}{" "}
              <Link
                href="/settings/locations"
                className="font-medium underline underline-offset-4"
              >
                Settings → Locations
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {staff.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center">
          <p>
            {t("hoursPage.empty")}{" "}
            <a
              href="/settings/staff"
              className="text-primary underline underline-offset-4"
            >
              {t("staffPage.title")}
            </a>{" "}
            first.
          </p>
        </div>
      ) : (
        <WorkingHoursPageClient
          staff={staff.map((s) => ({ id: s.id, name: s.displayName }))}
          initialHours={initialHours}
          initialOverrides={initialOverrides}
          initialStaffId={staff[0].id}
          locations={locations.filter((location) => location.isActive === 1)}
          missingByStaffId={missingByStaffId}
        />
      )}
    </div>
  );
}
