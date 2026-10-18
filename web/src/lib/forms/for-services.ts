import { and, eq, inArray } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import type { FormField } from "@/lib/validators/forms";

/**
 * Active form templates assigned to any of the given services, from the named
 * tenant. NO authorization and no header lookup: the slug must come from a
 * trusted source. Deduplicates by template ID. The public `getFormsForServices`
 * action and the booking confirmations both use this.
 */
export async function loadFormsForServices(slug: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return [];

  return withTenantDb(
    slug,
    async (db, { formTemplates, serviceFormAssignments }) => {
      const rows = await db
        .select({
          id: formTemplates.id,
          name: formTemplates.name,
          description: formTemplates.description,
          fields: formTemplates.fields,
        })
        .from(serviceFormAssignments)
        .innerJoin(
          formTemplates,
          eq(serviceFormAssignments.formTemplateId, formTemplates.id),
        )
        .where(
          and(
            inArray(serviceFormAssignments.serviceId, serviceIds),
            eq(formTemplates.isActive, 1),
          ),
        );

      // Deduplicate by template ID
      const seen = new Set<string>();
      const unique: typeof rows = [];
      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          unique.push(row);
        }
      }

      return unique.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        fields: r.fields as unknown as FormField[],
      }));
    },
  );
}
