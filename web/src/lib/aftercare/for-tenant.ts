import { withTenantDb } from "@/lib/db/tenant";
import { eq, and, inArray } from "drizzle-orm";

export async function getAftercareTemplatesForTenantServices(
  tenantSlug: string,
  serviceIds: string[],
) {
  if (serviceIds.length === 0) return [];

  return withTenantDb(
    tenantSlug,
    async (db, { aftercareTemplates, serviceAftercareAssignments }) => {
      const rows = await db
        .select({
          id: aftercareTemplates.id,
          name: aftercareTemplates.name,
          content: aftercareTemplates.content,
          productRecommendations: aftercareTemplates.productRecommendations,
        })
        .from(serviceAftercareAssignments)
        .innerJoin(
          aftercareTemplates,
          eq(
            serviceAftercareAssignments.aftercareTemplateId,
            aftercareTemplates.id,
          ),
        )
        .where(
          and(
            inArray(serviceAftercareAssignments.serviceId, serviceIds),
            eq(aftercareTemplates.isActive, 1),
          ),
        );

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
        content: r.content,
        productRecommendations: r.productRecommendations,
      }));
    },
  );
}
