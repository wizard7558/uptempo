import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { getLocationCoverageGaps, listLocations } from "@/actions/locations";
import { getT } from "@/lib/terms/server";
import { getTenantSlug } from "@/lib/tenant/context";
import { LocationsPageClient } from "./client";

export default async function LocationsPage() {
  const t = await getT("settings");
  const [locations, gaps, businessSlug] = await Promise.all([
    listLocations(),
    getLocationCoverageGaps(),
    getTenantSlug(),
  ]);

  // Group gaps by location for the banner.
  const byLocation = new Map<string, { name: string; staff: string[] }>();
  for (const gap of gaps) {
    const entry = byLocation.get(gap.locationId) ?? {
      name: gap.locationName,
      staff: [],
    };
    entry.staff.push(gap.staffName);
    byLocation.set(gap.locationId, entry);
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Locations</h1>
        <p className="mt-1 text-muted-foreground">
          {t("locationsPage.subtitle")}{" "}
          <Link
            href="/settings/hours"
            className="text-primary underline underline-offset-4"
          >
            Settings → Hours
          </Link>{" "}
          so it appears as a booking option.
        </p>
      </div>

      {byLocation.size > 0 && (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700/50 dark:bg-amber-950/20">
          <AlertTriangle className="size-5 shrink-0 text-amber-600" />
          <div className="space-y-1.5">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              Some locations aren&apos;t bookable yet
            </p>
            <ul className="list-disc space-y-1 pl-5 text-amber-900/90 dark:text-amber-200/90">
              {Array.from(byLocation.values()).map((entry) => (
                <li key={entry.name}>
                  <strong>{entry.name}</strong> has no working hours for{" "}
                  {entry.staff.length === 1
                    ? entry.staff[0]
                    : t("locationsPage.gapMany", {
                        count: entry.staff.length,
                        names: entry.staff.join(", "),
                      })}
                  {t("locationsPage.gapTail")}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              <Link
                href="/settings/hours"
                className="font-medium text-amber-900 underline underline-offset-4 dark:text-amber-200"
              >
                Set working hours →
              </Link>
            </p>
          </div>
        </div>
      )}

      <LocationsPageClient initialLocations={locations} businessSlug={businessSlug} />
    </div>
  );
}
