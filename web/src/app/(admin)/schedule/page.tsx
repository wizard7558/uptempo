import { listStaff } from "@/actions/staff";
import { getBusinessSettings } from "@/actions/policies";
import { listTaskTypes } from "@/actions/task-catalog";
import { getTenantSlug } from "@/lib/tenant/context";
import { hasModule } from "@/lib/tenant/modules";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { Suspense } from "react";
import ScheduleLoading from "./loading";

async function SchedulePageContent() {
  const slug = await getTenantSlug();
  const taskTypesPromise = listTaskTypes().catch(
    () => [] as Awaited<ReturnType<typeof listTaskTypes>>,
  );
  const [allStaff, policy, showAssistants, taskTypesResult] = await Promise.all([
    listStaff(),
    getBusinessSettings(),
    hasModule(slug, "assistant_tasks"),
    taskTypesPromise,
  ]);

  const staff = allStaff.filter((s) => s.role !== "assistant");
  const assistants = showAssistants
    ? allStaff.filter((s) => s.role === "assistant")
    : [];
  const taskTypes = showAssistants ? taskTypesResult : [];

  return (
    <div className="h-[calc(100dvh-3.5rem)] min-h-0 touch-manipulation overflow-x-auto">
      <ScheduleView
        staff={staff}
        assistants={assistants}
        timezone={policy.timezone}
        showAssistants={showAssistants}
        taskTypes={taskTypes}
      />
    </div>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<ScheduleLoading />}>
      <SchedulePageContent />
    </Suspense>
  );
}
