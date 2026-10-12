import { and, eq, inArray } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";

/**
 * Batch-fetch services currently offered by multiple stylists in a single query.
 * Returns Map<stylistId, { serviceId, serviceName }[]>. Service name uses the
 * stylist's `custom_name` override when present.
 *
 * Excludes services where `stylist_services.is_offered = 0` (stylist hid the
 * service) or `services.is_active = 0` (catalog soft-delete).
 */
export async function getServicesForStaff(
  db: TenantDb,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tables: { staffServices: any; services: any },
  staffIds: string[],
): Promise<Map<string, { serviceId: string; serviceName: string }[]>> {
  if (staffIds.length === 0) return new Map();

  const rows = await db
    .select({
      staffId: tables.staffServices.staffId,
      serviceId: tables.staffServices.serviceId,
      serviceName: tables.services.name,
      customName: tables.staffServices.customName,
    })
    .from(tables.staffServices)
    .innerJoin(
      tables.services,
      eq(tables.staffServices.serviceId, tables.services.id),
    )
    .where(
      and(
        inArray(tables.staffServices.staffId, staffIds),
        eq(tables.staffServices.isOffered, 1),
        eq(tables.services.isActive, 1),
      ),
    );

  const grouped = new Map<string, { serviceId: string; serviceName: string }[]>();
  for (const row of rows) {
    const existing = grouped.get(row.staffId) ?? [];
    existing.push({
      serviceId: row.serviceId,
      serviceName: row.customName ?? row.serviceName,
    });
    grouped.set(row.staffId, existing);
  }
  return grouped;
}
