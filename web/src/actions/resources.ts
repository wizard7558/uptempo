"use server";

import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import { withTenantDb } from "@/lib/db/tenant";
import { pgErrorInfo } from "@/lib/db/pg-error";
import { getT } from "@/lib/terms/server";
import {
  createResourcesSchema,
  updateResourceSchema,
  type CreateResourcesInput,
  type UpdateResourceInput,
} from "@/lib/validators/resource";

export type ResourceRow = {
  id: string;
  name: string;
  kind: string;
  locationId: string | null;
  locationName: string | null;
  capacity: number;
  isActive: number;
};

type Failure = { success: false; error: { message: string } };

/** Every room and piece of equipment, oldest first (so "Chair 1" stays above "Chair 2"). */
export async function listResources(): Promise<ResourceRow[]> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { resources, locations }) =>
    db
      .select({
        id: resources.id,
        name: resources.name,
        kind: resources.kind,
        locationId: resources.locationId,
        locationName: locations.name,
        capacity: resources.capacity,
        isActive: resources.isActive,
      })
      .from(resources)
      .leftJoin(locations, eq(locations.id, resources.locationId))
      .orderBy(asc(resources.createdAt), asc(resources.name), asc(resources.id)),
  );
}

export async function createResources(
  data: CreateResourcesInput,
): Promise<{ success: true; ids: string[] } | Failure> {
  const session = await requireRole("owner", "admin");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const parsed = createResourcesSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: { message: "Invalid room or equipment" } };
  }
  const { name, kind, locationId, capacity, count } = parsed.data;
  try {
  const slug = session.tenantSlug;
    const rows = await withTenantDb(slug, async (db, { resources }) =>
      db
        .insert(resources)
        .values(
          Array.from({ length: count }, (_, i) => ({
            name: count > 1 ? `${name} ${i + 1}` : name,
            kind,
            locationId,
            capacity,
          })),
        )
        .returning({ id: resources.id }),
    );
    revalidatePath("/settings/resources");
    revalidatePath("/services");
    return { success: true, ids: rows.map((r) => r.id) };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return { success: false, error: { message: "Failed to add" } };
  }
}

export async function updateResource(
  data: UpdateResourceInput,
): Promise<{ success: true } | Failure> {
  const session = await requireRole("owner", "admin");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const parsed = updateResourceSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: { message: "Invalid room or equipment" } };
  }
  const { id, ...changes } = parsed.data;
  try {
  const slug = session.tenantSlug;
    const found = await withTenantDb(slug, async (db, { resources, appointmentResources }) =>
      db.transaction(async (tx) => {
        const updated = await tx
          .update(resources)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(resources.id, id))
          .returning({ id: resources.id });
        if (updated.length === 0) return false;
        if (changes.capacity !== undefined) {
          // The database sets is_exclusive from capacity when a row is written; rows
          // that already exist follow the new capacity from now on. Going to 1 fails
          // (and rolls back) when upcoming rows overlap.
          await tx
            .update(appointmentResources)
            .set({ isExclusive: changes.capacity === 1 ? 1 : 0 })
            .where(
              sql`${appointmentResources.resourceId} = ${id} AND upper(${appointmentResources.during}) > now()`,
            );
        }
        return true;
      }),
    );
    if (!found) return { success: false, error: { message: "Not found" } };
    revalidatePath("/settings/resources");
    revalidatePath("/services");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    if (pgErrorInfo(err).code === "23P01") {
      const t = await getT("settings");
      return { success: false, error: { message: t("resources.capacityConflict") } };
    }
    return { success: false, error: { message: "Failed to save" } };
  }
}
