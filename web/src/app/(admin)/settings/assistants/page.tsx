import { requireRole } from "@/lib/auth/rbac";
import { getTenantSlug } from "@/lib/tenant/context";
import { requireModule } from "@/lib/tenant/modules";
import { getTenantIndustry } from "@/lib/tenant/industry";
import { getDefaultAssistantTasksForIndustry } from "@/lib/services/default-assistant-tasks";
import { listTaskTypes } from "@/actions/task-catalog";
import { listStaff } from "@/actions/staff";
import { AssistantsPageClient } from "./client";

export default async function AssistantsSettingsPage() {
  const { tenantSlug } = await requireRole("owner", "admin");
  await requireModule("assistant_tasks");

  const [taskTypes, allStaff, industry] = await Promise.all([
    listTaskTypes(),
    listStaff(),
    getTenantIndustry(tenantSlug ?? (await getTenantSlug())),
  ]);

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
        hasDefaultTasks={
          getDefaultAssistantTasksForIndustry(industry).length > 0
        }
        assistants={assistants.map((a) => ({
          id: a.id,
          displayName: a.displayName,
          email: a.email,
        }))}
      />
    </div>
  );
}
