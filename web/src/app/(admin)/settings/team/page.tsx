import { getT } from "@/lib/terms/server";
import { requireRole } from "@/lib/auth/rbac";
import { listInvitations, listTeamMembers } from "@/actions/team";
import { SettingsPageShell } from "@/components/settings/settings-page-shell";
import { TeamPageClient } from "./client";
import { ShieldAlert } from "lucide-react";

export default async function TeamPage() {
  await requireRole("owner", "admin");
  const t = await getT("settings");
  const [{ invitations, unavailable: invitationsUnavailable }, members] =
    await Promise.all([listInvitations(), listTeamMembers()]);

  return (
    <SettingsPageShell
      title="Team Management"
      description={t("teamPage.description")}
    >
      {invitationsUnavailable ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-12 text-center">
          <ShieldAlert className="size-12 text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Team Invitations Unavailable</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This database is missing the latest team invitation schema. Run the
              latest migrations, then reload this page.
            </p>
          </div>
        </div>
      ) : (
        <TeamPageClient
          initialInvitations={invitations}
          initialMembers={members}
        />
      )}
    </SettingsPageShell>
  );
}
