"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { withTenantDb } from "@/lib/db/tenant";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import {
  createAftercareTemplateSchema,
  updateAftercareTemplateSchema,
} from "@/lib/validators/forms";
import { getAftercareTemplatesForTenantServices } from "@/lib/aftercare/for-tenant";

/**
 * Create a new aftercare template with optional service assignments.
 */
export async function createAftercareTemplate(input: unknown) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createAftercareTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.message };
  }

  const { name, content, productRecommendations, serviceIds } = parsed.data;

  return withTenantDb(
    slug,
    async (db, { aftercareTemplates, serviceAftercareAssignments }) => {
      const [template] = await db
        .insert(aftercareTemplates)
        .values({
          name,
          content,
          productRecommendations: productRecommendations ?? null,
        })
        .returning({ id: aftercareTemplates.id });

      if (serviceIds && serviceIds.length > 0) {
        await db.insert(serviceAftercareAssignments).values(
          serviceIds.map((serviceId) => ({
            serviceId,
            aftercareTemplateId: template.id,
          })),
        );
      }

      trackEvent("aftercare.created", { templateId: template.id, serviceCount: serviceIds?.length ?? 0 }, { tenantSlug: slug });

      revalidatePath("/settings/aftercare");
      return { success: true as const, id: template.id };
    },
  );
}

/**
 * Update an existing aftercare template and its service assignments.
 */
export async function updateAftercareTemplate(input: unknown) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateAftercareTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.message };
  }

  const { id, serviceIds, ...updates } = parsed.data;

  return withTenantDb(
    slug,
    async (db, { aftercareTemplates, serviceAftercareAssignments }) => {
      const setValues: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.name !== undefined) setValues.name = updates.name;
      if (updates.content !== undefined) setValues.content = updates.content;
      if (updates.productRecommendations !== undefined)
        setValues.productRecommendations = updates.productRecommendations;
      if (updates.isActive !== undefined) setValues.isActive = updates.isActive;

      await db
        .update(aftercareTemplates)
        .set(setValues)
        .where(eq(aftercareTemplates.id, id));

      if (serviceIds !== undefined) {
        await db
          .delete(serviceAftercareAssignments)
          .where(eq(serviceAftercareAssignments.aftercareTemplateId, id));

        if (serviceIds.length > 0) {
          await db.insert(serviceAftercareAssignments).values(
            serviceIds.map((serviceId) => ({
              serviceId,
              aftercareTemplateId: id,
            })),
          );
        }
      }

      trackEvent("aftercare.updated", { templateId: id }, { tenantSlug: slug });

      revalidatePath("/settings/aftercare");
      return { success: true as const };
    },
  );
}

/**
 * List all aftercare templates with their assigned service IDs.
 */
export async function listAftercareTemplates() {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(
    slug,
    async (db, { aftercareTemplates, serviceAftercareAssignments }) => {
      const templates = await db
        .select()
        .from(aftercareTemplates)
        .orderBy(aftercareTemplates.createdAt);

      const templateIds = templates.map((t) => t.id);
      if (templateIds.length === 0) return [];

      const assignments = await db
        .select({
          aftercareTemplateId:
            serviceAftercareAssignments.aftercareTemplateId,
          serviceId: serviceAftercareAssignments.serviceId,
        })
        .from(serviceAftercareAssignments)
        .where(
          inArray(
            serviceAftercareAssignments.aftercareTemplateId,
            templateIds,
          ),
        );

      const assignmentMap = new Map<string, string[]>();
      for (const a of assignments) {
        const existing = assignmentMap.get(a.aftercareTemplateId) ?? [];
        existing.push(a.serviceId);
        assignmentMap.set(a.aftercareTemplateId, existing);
      }

      return templates.map((t) => ({
        ...t,
        serviceIds: assignmentMap.get(t.id) ?? [],
      }));
    },
  );
}

/**
 * Fetch a single aftercare template by ID with its service assignments.
 */
export async function getAftercareTemplate(id: string) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(
    slug,
    async (db, { aftercareTemplates, serviceAftercareAssignments }) => {
      const [template] = await db
        .select()
        .from(aftercareTemplates)
        .where(eq(aftercareTemplates.id, id))
        .limit(1);

      if (!template) return null;

      const assignments = await db
        .select({ serviceId: serviceAftercareAssignments.serviceId })
        .from(serviceAftercareAssignments)
        .where(eq(serviceAftercareAssignments.aftercareTemplateId, id));

      return {
        ...template,
        serviceIds: assignments.map((a) => a.serviceId),
      };
    },
  );
}

export async function getAftercareForServices(serviceIds: string[]) {
  const { tenantSlug: slug } = await requireStaff();
  return getAftercareTemplatesForTenantServices(slug, serviceIds);
}

/**
 * Deactivate an aftercare template (soft delete).
 */
export async function deactivateAftercareTemplate(id: string) {
  const { tenantSlug: slug } = await requireStaff();

  return withTenantDb(slug, async (db, { aftercareTemplates }) => {
    const [result] = await db
      .update(aftercareTemplates)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(eq(aftercareTemplates.id, id))
      .returning({ id: aftercareTemplates.id });

    if (!result) {
      return {
        success: false as const,
        error: "Aftercare template not found",
      };
    }

    trackEvent("aftercare.deleted", { templateId: id }, { tenantSlug: slug });

    revalidatePath("/settings/aftercare");
    return { success: true as const };
  });
}
