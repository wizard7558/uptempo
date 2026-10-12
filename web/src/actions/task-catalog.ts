"use server";

import { withTenantDb } from "@/lib/db/tenant";
import { AuthError, requireRole } from "@/lib/auth/rbac";
import { assertModule } from "@/lib/tenant/modules";
import { taskCatalogSchema } from "@/lib/validators/assistant-task";
import { eq, asc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import { DEFAULT_ASSISTANT_TASKS } from "@/lib/services/default-assistant-tasks";

/**
 * Create a new task type in the catalog.
 * Requires owner or admin role and the assistant_tasks module.
 */
export async function createTaskType(data: {
  name: string;
  defaultDurationMinutes: number;
}): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;
  try {
    const parsed = taskCatalogSchema.safeParse(data);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0].message };
    }

    await assertModule(slug, "assistant_tasks");

    const result = await withTenantDb(slug, async (db, { taskCatalog }) => {
      const [row] = await db
        .insert(taskCatalog)
        .values({
          name: parsed.data.name,
          defaultDurationMinutes: parsed.data.defaultDurationMinutes,
        })
        .returning({ id: taskCatalog.id });
      return row;
    });

    trackEvent(
      "task_type.created",
      { taskTypeId: result.id },
      { tenantSlug: slug },
    );

    revalidatePath("/settings/assistants");
    return { success: true, id: result.id };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[TaskCatalog] Failed to create task type:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to create task type",
    };
  }
}

/**
 * Seed the standard assistant task catalog for salons that have not customized
 * their active catalog yet.
 */
export async function seedDefaultTaskTypes(): Promise<
  { success: true; created: number } | { success: false; error: string }
> {
  const { tenantSlug } = await requireRole("owner", "admin");
    if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;
  try {
    await assertModule(slug, "assistant_tasks");

    const created = await withTenantDb(slug, async (db, { taskCatalog }) => {
      const existingRows = await db
        .select({ name: taskCatalog.name })
        .from(taskCatalog)
        .where(eq(taskCatalog.isActive, 1));

      const existingNames = new Set(
        existingRows.map((row) => row.name.trim().toLocaleLowerCase()),
      );
      const missingTasks = DEFAULT_ASSISTANT_TASKS.filter(
        (task) => !existingNames.has(task.name.toLocaleLowerCase()),
      );

      if (missingTasks.length === 0) {
        return 0;
      }

      const rows = await db
        .insert(taskCatalog)
        .values(missingTasks)
        .returning({ id: taskCatalog.id });

      return rows.length;
    });

    if (created > 0) {
      trackEvent(
        "task_type.defaults_seeded",
        { created },
        { tenantSlug: slug },
      );
    }

    revalidatePath("/settings/assistants");
    return { success: true, created };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[TaskCatalog] Failed to seed default task types:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to seed default task types",
    };
  }
}

/**
 * Update an existing task type.
 * Requires owner or admin role.
 */
export async function updateTaskType(
  id: string,
  data: { name?: string; defaultDurationMinutes?: number },
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin");
    if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;
  try {

    const result = await withTenantDb(slug, async (db, { taskCatalog }) => {
      return db
        .update(taskCatalog)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(taskCatalog.id, id))
        .returning({ id: taskCatalog.id });
    });

    if (result.length === 0) {
      return { success: false, error: "Task type not found" };
    }

    trackEvent("task_type.updated", { taskTypeId: id }, { tenantSlug: slug });

    revalidatePath("/settings/assistants");
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[TaskCatalog] Failed to update task type:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to update task type",
    };
  }
}

/**
 * List all active task types, ordered by name.
 * Any salon staff role can view (returns empty if no catalog entries).
 */
export async function listTaskTypes(): Promise<
  Array<{ id: string; name: string; defaultDurationMinutes: number }>
> {
  const { tenantSlug } = await requireRole(
    "owner",
    "admin",
    "provider",
    "assistant",
  );
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;

  return withTenantDb(slug, async (db, { taskCatalog }) => {
    return db
      .select({
        id: taskCatalog.id,
        name: taskCatalog.name,
        defaultDurationMinutes: taskCatalog.defaultDurationMinutes,
      })
      .from(taskCatalog)
      .where(eq(taskCatalog.isActive, 1))
      .orderBy(asc(taskCatalog.name));
  });
}

/**
 * Soft-delete a task type by setting isActive=0.
 * Requires owner or admin role.
 */
export async function deleteTaskType(
  id: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin");
    if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;
  try {

    const result = await withTenantDb(slug, async (db, { taskCatalog }) => {
      return db
        .update(taskCatalog)
        .set({ isActive: 0, updatedAt: new Date() })
        .where(eq(taskCatalog.id, id))
        .returning({ id: taskCatalog.id });
    });

    if (result.length === 0) {
      return { success: false, error: "Task type not found" };
    }

    trackEvent("task_type.deleted", { taskTypeId: id }, { tenantSlug: slug });

    revalidatePath("/settings/assistants");
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[TaskCatalog] Failed to delete task type:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to delete task type",
    };
  }
}
