import { eq, and, inArray } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { trackEvent } from "@/lib/analytics/events";

/**
 * Reasons an auto-task can fail to be created. Surfaced via analytics so we
 * can tell whether the feature is "broken" or just under-configured for a
 * given booking.
 */
export type AutoTaskSkipReason =
  | "assistant_module_off"
  | "appointment_not_found"
  | "appointment_cancelled"
  | "no_services"
  | "no_default_assistant"
  | "stylist_is_assistant"
  | "assistant_inactive_or_wrong_role"
  | "no_flagged_services"
  | "overlap_constraint"
  | "insert_failed";

function trackSkip(
  tenantSlug: string,
  appointmentId: string,
  reason: AutoTaskSkipReason,
  extra: Record<string, string | number | boolean | null | undefined> = {},
) {
  trackEvent(
    "auto_task.skipped",
    { appointmentId, reason, ...extra },
    { tenantSlug },
  );
}

/**
 * Recompute auto-generated assistant tasks for an appointment from:
 * - services with assistant_workflow = 1 in the booked line items
 * - the booked staff member's default_assistant_id (must be an active assistant)
 *
 * Deletes prior auto tasks for this appointment, then inserts at most one task
 * covering the full appointment window (avoids overlap conflicts on the assistant).
 *
 * Every "silent skip" path emits an `auto_task.skipped` analytics event with
 * a structured reason. This makes it possible to debug "why didn't an
 * assistant task appear" without manual inspection.
 */
export async function syncAutoAssistantTasksForAppointment(
  tenantSlug: string,
  appointmentId: string,
): Promise<void> {
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant || !isModuleEnabled(tenant.modules, "assistant_tasks")) {
    trackSkip(tenantSlug, appointmentId, "assistant_module_off");
    return;
  }

  await withTenantDb(tenantSlug, async (db, tables) => {
    const {
      appointments,
      appointmentServices,
      services,
      staff,
      assistantTasks,
      taskCatalog,
    } = tables;

    await db.transaction(async (tx) => {
      const [appt] = await tx
        .select({
          id: appointments.id,
          staffId: appointments.staffId,
          during: appointments.during,
          status: appointments.status,
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);

      if (!appt) {
        trackSkip(tenantSlug, appointmentId, "appointment_not_found");
        return;
      }

      if (appt.status === "cancelled") {
        await tx
          .delete(assistantTasks)
          .where(
            and(
              eq(assistantTasks.appointmentId, appointmentId),
              eq(assistantTasks.isAuto, 1),
            ),
          );
        trackSkip(tenantSlug, appointmentId, "appointment_cancelled");
        return;
      }

      await tx
        .delete(assistantTasks)
        .where(
          and(
            eq(assistantTasks.appointmentId, appointmentId),
            eq(assistantTasks.isAuto, 1),
          ),
        );

      const lines = await tx
        .select({ serviceId: appointmentServices.serviceId })
        .from(appointmentServices)
        .where(eq(appointmentServices.appointmentId, appointmentId));

      const serviceIds = lines
        .map((l) => l.serviceId)
        .filter((id): id is string => id != null);

      if (serviceIds.length === 0) {
        trackSkip(tenantSlug, appointmentId, "no_services");
        return;
      }

      const [staffRow] = await tx
        .select({
          defaultAssistantId: staff.defaultAssistantId,
          role: staff.role,
        })
        .from(staff)
        .where(eq(staff.id, appt.staffId))
        .limit(1);

      if (!staffRow?.defaultAssistantId) {
        trackSkip(tenantSlug, appointmentId, "no_default_assistant", {
          staffId: appt.staffId,
        });
        return;
      }
      if (staffRow.role === "assistant") {
        trackSkip(tenantSlug, appointmentId, "stylist_is_assistant", {
          staffId: appt.staffId,
        });
        return;
      }

      const [assistantRow] = await tx
        .select({ id: staff.id, role: staff.role, isActive: staff.isActive })
        .from(staff)
        .where(eq(staff.id, staffRow.defaultAssistantId))
        .limit(1);

      if (
        !assistantRow ||
        assistantRow.role !== "assistant" ||
        assistantRow.isActive !== 1
      ) {
        trackSkip(tenantSlug, appointmentId, "assistant_inactive_or_wrong_role", {
          assistantId: staffRow.defaultAssistantId,
        });
        return;
      }

      const svcRows = await tx
        .select({
          id: services.id,
          name: services.name,
          assistantWorkflow: services.assistantWorkflow,
          assistantTaskTypeId: services.assistantTaskTypeId,
        })
        .from(services)
        .where(
          and(inArray(services.id, serviceIds), eq(services.isActive, 1)),
        );

      const flagged = svcRows.filter((s) => s.assistantWorkflow === 1);
      if (flagged.length === 0) {
        trackSkip(tenantSlug, appointmentId, "no_flagged_services", {
          serviceCount: serviceIds.length,
        });
        return;
      }

      const withType = flagged.find((s) => s.assistantTaskTypeId != null);
      const taskTypeId = withType?.assistantTaskTypeId ?? null;

      let taskName = flagged.map((s) => s.name).join(" + ");
      if (taskTypeId) {
        const [tc] = await tx
          .select({ name: taskCatalog.name })
          .from(taskCatalog)
          .where(
            and(eq(taskCatalog.id, taskTypeId), eq(taskCatalog.isActive, 1)),
          )
          .limit(1);
        if (tc) {
          taskName = tc.name;
        }
      }

      try {
        await tx.insert(assistantTasks).values({
          appointmentId,
          assignedTo: assistantRow.id,
          taskTypeId: taskTypeId ?? undefined,
          taskName,
          during: appt.during,
          status: "pending",
          isAuto: 1,
        });
      } catch (e) {
        // Overlap with another task for this assistant — don't fail the booking
        console.warn(
          "[syncAutoAssistantTasksForAppointment] Could not insert auto task:",
          e,
        );
        const reason: AutoTaskSkipReason =
          e instanceof Error &&
          e.message?.includes("assistant_tasks_no_overlap")
            ? "overlap_constraint"
            : "insert_failed";
        trackSkip(tenantSlug, appointmentId, reason, {
          assistantId: assistantRow.id,
        });
      }
    });
  });
}
