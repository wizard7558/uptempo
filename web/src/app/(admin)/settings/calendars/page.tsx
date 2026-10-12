import { getT } from "@/lib/terms/server";
import { listStaff } from "@/actions/staff";
import { getCalendarConnections } from "@/actions/calendar-connections";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { CalendarConnections } from "@/components/settings/calendar-connections";

export default async function CalendarSettingsPage() {
  const t = await getT("settings");
  const staff = await listStaff();

  // For the pilot (single-salon), show connections for all stylists
  // In future SaaS, this would be scoped to the logged-in stylist
  const connectionsPerStaffMember = await Promise.all(
    staff.map(async (staffMember) => ({
      staffId: staffMember.id,
      staffName: staffMember.displayName,
      connections: await getCalendarConnections(staffMember.id),
    })),
  );

  return (
    <SettingsPageShell
      title="Calendar Connections"
      description="Connect Google Calendar to prevent double-booking and sync appointments."
    >
      {connectionsPerStaffMember.map(
        ({ staffId, staffName, connections }) => (
          <div key={staffId} className="space-y-4">
            <h2 className="text-lg font-medium">{staffName}</h2>
            <CalendarConnections
              staffId={staffId}
              initialConnections={connections}
            />
          </div>
        ),
      )}

      {staff.length === 0 && (
        <p className="text-muted-foreground">
          {t("calendarsPage.empty")}
        </p>
      )}
    </SettingsPageShell>
  );
}
