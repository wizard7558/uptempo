import { eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import type { AreaRow } from "./service-area";

/** Every active service area of the business, for `checkServiceArea`. */
export async function loadActiveAreas(slug: string): Promise<AreaRow[]> {
  const rows = await withTenantDb(slug, async (db, { serviceAreas }) =>
    db.select().from(serviceAreas).where(eq(serviceAreas.isActive, 1)),
  );
  return rows.map((r) => ({
    id: r.id,
    staffId: r.staffId,
    kind: r.kind as AreaRow["kind"],
    postalCodes: r.postalCodes,
    centerLat: r.centerLat,
    centerLng: r.centerLng,
    radiusKm: r.radiusKm == null ? null : Number(r.radiusKm),
  }));
}
