import { requireRole } from "@/lib/auth/rbac";
import { requireModule } from "@/lib/tenant/modules";
import { listTaskTypes } from "@/actions/task-catalog";
import { listStaff } from "@/actions/staff";
import { AssistantsPageClient } from "./client";

export default async function AssistantsSettingsPage() {
  await requireRole("owner", "admin");
  await requireModule("assistant_tasks");

  const [taskTypes, allStaff] = await Promise.all([listTaskTypes(), listStaff()]);

  const assistants = allStaff.filter((s) => s.role === "assistant");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Assistants</h1>
        <p className="text-muted-foreground mt-1">
          Manage assistant task types and view your assistant roster.
        </p>
      </div>

      <AssistantsPageClient
        initialTaskTypes={taskTypes}
        assistants={assistants.map((a) => ({
          id: a.id,
          displayName: a.displayName,
          email: a.email,
        }))}
      />
    </div>
  );
}
