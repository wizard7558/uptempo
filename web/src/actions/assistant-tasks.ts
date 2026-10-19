"use server";

import { withTenantDb } from "@/lib/db/tenant";
import { AuthError, requireRole } from "@/lib/auth/rbac";
import { assertModule } from "@/lib/tenant/modules";
import {
  assignTaskSchema,
  updateTaskSchema,
} from "@/lib/validators/assistant-task";
import { eq, and, sql, ne, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";

const OVERLAP_CONSTRAINT = "assistant_tasks_no_overlap";

/**
 * Detect the assistant_tasks_no_overlap exclusion-constraint violation
 * across the various shapes drizzle/postgres-js can throw.
 */
function isOverlapViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: string;
    constraint?: string;
    constraint_name?: string;
    message?: string;
    cause?: unknown;
  };
  if (e.code === "23P01") return true;
  if (e.constraint === OVERLAP_CONSTRAINT) return true;
  if (e.constraint_name === OVERLAP_CONSTRAINT) return true;
  if (typeof e.message === "string" && e.message.includes(OVERLAP_CONSTRAINT))
    return true;
  if (e.cause && e.cause !== err && isOverlapViolation(e.cause)) return true;
  return false;
}

/**
 * Assign a task to an assistant for a specific appointment.
 * Enforces feature gate, validates assistant role, and catches
 * exclusion constraint violations for overlapping time ranges.
 */
export async function assignTask(data: {
  /** Null/omitted creates a standalone task (no appointment context). */
  appointmentId?: string | null;
  assignedTo: string;
  taskTypeId?: string;
  taskName: string;
  startTime: Date;
  endTime: Date;
  notes?: string;
}): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin", "provider");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;
  try {
    const parsed = assignTaskSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    await assertModule(slug, "assistant_tasks");

    const result = await withTenantDb(
      slug,
      async (db, { assistantTasks, staff }) => {
        // Verify the assignedTo stylist has role="assistant"
        const [assistant] = await db
          .select({ id: staff.id, role: staff.role })
          .from(staff)
          .where(
            and(eq(staff.id, parsed.data.assignedTo), eq(staff.isActive, 1)),
          )
          .limit(1);

        if (!assistant) {
          throw new Error("Assistant not found");
        }
        if (assistant.role !== "assistant") {
          throw new Error("Selected staff member is not an assistant");
        }

        const [row] = await db
          .insert(assistantTasks)
          .values({
            appointmentId: parsed.data.appointmentId ?? null,
            assignedTo: parsed.data.assignedTo,
            taskTypeId: parsed.data.taskTypeId,
            taskName: parsed.data.taskName,
            during: {
              start: parsed.data.startTime,
              end: parsed.data.endTime,
            },
            notes: parsed.data.notes,
          })
          .returning({ id: assistantTasks.id });

        return row;
      },
    );

    revalidatePath("/schedule");
    trackEvent("assistant.task_assigned", {}, { tenantSlug: slug });
    return { success: true, id: result.id };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[AssistantTasks] Failed to assign task:", error);
    if (isOverlapViolation(error)) {
      return {
        success: false,
        error: "This assistant already has a task during that time",
      };
    }
    if (error instanceof Error && error.message === "Assistant not found") {
      return { success: false, error: "Assistant not found" };
    }
    if (
      error instanceof Error &&
      error.message === "Selected staff member is not an assistant"
    ) {
      return {
        success: false,
        error: "Selected staff member is not an assistant",
      };
    }
    return { success: false, error: "Failed to assign task" };
  }
}

/**
 * Update an existing assistant task.
 * Catches exclusion constraint violations for overlapping time ranges.
 */
export async function updateTask(data: {
  id: string;
  taskName?: string;
  startTime?: Date;
  endTime?: Date;
  status?: "pending" | "in-progress" | "completed" | "cancelled";
  notes?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin", "provider");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;
  try {
    const parsed = updateTaskSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }


    const result = await withTenantDb(slug, async (db, { assistantTasks }) => {
      // Build update values
      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (parsed.data.taskName !== undefined) {
        updates.taskName = parsed.data.taskName;
      }
      if (parsed.data.status !== undefined) {
        updates.status = parsed.data.status;
      }
      if (parsed.data.notes !== undefined) {
        updates.notes = parsed.data.notes;
      }

      // If time range is being updated, rebuild the during range
      if (parsed.data.startTime !== undefined || parsed.data.endTime !== undefined) {
        // Need to fetch current values if only one is provided
        const [current] = await db
          .select({ during: assistantTasks.during })
          .from(assistantTasks)
          .where(eq(assistantTasks.id, parsed.data.id))
          .limit(1);

        if (!current) {
          throw new Error("Task not found");
        }

        const currentRange = current.during as { start: Date; end: Date };
        const start = parsed.data.startTime ?? currentRange.start;
        const end = parsed.data.endTime ?? currentRange.end;

        updates.during = { start, end };
      }

      return db
        .update(assistantTasks)
        .set(updates)
        .where(eq(assistantTasks.id, parsed.data.id))
        .returning({ id: assistantTasks.id });
    });

    if (result.length === 0) {
      return { success: false, error: "Task not found" };
    }

    revalidatePath("/schedule");
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[AssistantTasks] Failed to update task:", error);
    if (isOverlapViolation(error)) {
      return {
        success: false,
        error: "This assistant already has a task during that time",
      };
    }
    if (error instanceof Error && error.message === "Task not found") {
      return { success: false, error: "Task not found" };
    }
    return { success: false, error: "Failed to update task" };
  }
}

/**
 * Delete an assistant task.
 */
export async function deleteTask(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin", "provider");
    if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;
  try {

    const result = await withTenantDb(slug, async (db, { assistantTasks }) => {
      return db
        .delete(assistantTasks)
        .where(eq(assistantTasks.id, id))
        .returning({ id: assistantTasks.id });
    });

    if (result.length === 0) {
      return { success: false, error: "Task not found" };
    }

    revalidatePath("/schedule");
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[AssistantTasks] Failed to delete task:", error);
    return { success: false, error: "Failed to delete task" };
  }
}

/**
 * List tasks for a specific appointment, joined with assistant name.
 * Excludes cancelled tasks.
 */
export async function listTasksForAppointment(
  appointmentId: string,
): Promise<
  Array<{
    id: string;
    taskName: string;
    during: { start: Date; end: Date };
    status: string;
    notes: string | null;
    assignedTo: string;
    assignedToName: string;
  }>
> {
  const { tenantSlug } = await requireRole("owner", "admin", "provider");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;

  return withTenantDb(slug, async (db, { assistantTasks, staff }) => {
    const rows = await db
      .select({
        id: assistantTasks.id,
        taskName: assistantTasks.taskName,
        during: assistantTasks.during,
        status: assistantTasks.status,
        notes: assistantTasks.notes,
        assignedTo: assistantTasks.assignedTo,
        assignedToName: staff.displayName,
      })
      .from(assistantTasks)
      .innerJoin(staff, eq(assistantTasks.assignedTo, staff.id))
      .where(
        and(
          eq(assistantTasks.appointmentId, appointmentId),
          ne(assistantTasks.status, "cancelled"),
        ),
      )
      .orderBy(assistantTasks.during);

    return rows;
  });
}

/**
 * List tasks for a specific assistant on a given date.
 * Used by the schedule view to render task blocks on assistant columns.
 */
export async function listTasksForAssistant(
  assistantId: string,
  date: Date,
): Promise<
  Array<{
    id: string;
    taskName: string;
    during: { start: Date; end: Date };
    status: string;
    notes: string | null;
    appointmentId: string | null;
  }>
> {
  const { tenantSlug } = await requireRole("owner", "admin", "provider", "assistant");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;

  // Build day range in UTC -- the caller should pass a date in the salon's timezone
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  return withTenantDb(slug, async (db, { assistantTasks }) => {
    const rows = await db
      .select({
        id: assistantTasks.id,
        taskName: assistantTasks.taskName,
        during: assistantTasks.during,
        status: assistantTasks.status,
        notes: assistantTasks.notes,
        appointmentId: assistantTasks.appointmentId,
      })
      .from(assistantTasks)
      .where(
        and(
          eq(assistantTasks.assignedTo, assistantId),
          ne(assistantTasks.status, "cancelled"),
          sql`${assistantTasks.during} && tstzrange(${dayStart.toISOString()}, ${dayEnd.toISOString()}, '[]')`,
        ),
      )
      .orderBy(assistantTasks.during);

    return rows;
  });
}

export async function listTasksForAssistants(
  assistantIds: string[],
  date: Date,
): Promise<
  Record<
    string,
    Array<{
      id: string;
      taskName: string;
      during: { start: Date; end: Date };
      status: string;
      notes: string | null;
      appointmentId: string | null;
    }>
  >
> {
  if (assistantIds.length === 0) {
    return {};
  }

  const { tenantSlug } = await requireRole(
    "owner",
    "admin",
    "provider",
    "assistant",
  );
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  return withTenantDb(slug, async (db, { assistantTasks }) => {
    const rows = await db
      .select({
        id: assistantTasks.id,
        taskName: assistantTasks.taskName,
        during: assistantTasks.during,
        status: assistantTasks.status,
        notes: assistantTasks.notes,
        appointmentId: assistantTasks.appointmentId,
        assignedTo: assistantTasks.assignedTo,
      })
      .from(assistantTasks)
      .where(
        and(
          inArray(assistantTasks.assignedTo, assistantIds),
          ne(assistantTasks.status, "cancelled"),
          sql`${assistantTasks.during} && tstzrange(${dayStart.toISOString()}, ${dayEnd.toISOString()}, '[]')`,
        ),
      )
      .orderBy(assistantTasks.during);

    return rows.reduce<
      Record<
        string,
        Array<{
          id: string;
          taskName: string;
          during: { start: Date; end: Date };
          status: string;
          notes: string | null;
          appointmentId: string | null;
        }>
      >
    >((grouped, row) => {
      grouped[row.assignedTo] ??= [];
      grouped[row.assignedTo].push({
        id: row.id,
        taskName: row.taskName,
        during: row.during,
        status: row.status,
        notes: row.notes,
        appointmentId: row.appointmentId,
      });
      return grouped;
    }, {});
  });
}

/**
 * Fetch a single task for the detail/edit dialog. Returns assistant id +
 * displayName so the dialog can render context without a second query.
 */
export async function getTaskById(taskId: string): Promise<
  | {
      id: string;
      appointmentId: string | null;
      assignedTo: string;
      assignedToName: string;
      taskName: string;
      during: { start: Date; end: Date };
      status: string;
      notes: string | null;
    }
  | null
> {
  const { tenantSlug } = await requireRole(
    "owner",
    "admin",
    "provider",
    "assistant",
  );
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const slug = tenantSlug;

  return withTenantDb(slug, async (db, { assistantTasks, staff }) => {
    const [row] = await db
      .select({
        id: assistantTasks.id,
        appointmentId: assistantTasks.appointmentId,
        assignedTo: assistantTasks.assignedTo,
        assignedToName: staff.displayName,
        taskName: assistantTasks.taskName,
        during: assistantTasks.during,
        status: assistantTasks.status,
        notes: assistantTasks.notes,
      })
      .from(assistantTasks)
      .innerJoin(staff, eq(assistantTasks.assignedTo, staff.id))
      .where(eq(assistantTasks.id, taskId))
      .limit(1);

    if (!row) return null;
    return row;
  });
}
