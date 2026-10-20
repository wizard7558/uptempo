"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import {
  createLocationSchema,
  updateLocationSchema,
} from "@/lib/validators/location";

export async function listLocations() {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { locations }) => {
    return db
      .select({
        id: locations.id,
        name: locations.name,
        address: locations.address,
        isActive: locations.isActive,
        createdAt: locations.createdAt,
        updatedAt: locations.updatedAt,
      })
      .from(locations)
      .orderBy(asc(locations.createdAt), asc(locations.name));
  });
}

export async function listActiveLocations() {
  const slug = await getTenantSlug();
  return withTenantDb(slug, async (db, { locations }) => {
    return db
      .select({
        id: locations.id,
        name: locations.name,
        address: locations.address,
      })
      .from(locations)
      .where(eq(locations.isActive, 1))
      .orderBy(asc(locations.createdAt), asc(locations.name));
  });
}

/**
 * Active locations where the staff member has enabled hours. `"any"` returns the
 * locations where any active staff member works ("Anyone available").
 */
export async function getStaffLocations(staffId: string) {
  const slug = await getTenantSlug();
  return withTenantDb(slug, async (db, { locations, workingHours, staff }) => {
    const isAny = staffId === "any";
    const rows = await db
      .selectDistinct({
        id: locations.id,
        name: locations.name,
        address: locations.address,
        createdAt: locations.createdAt,
      })
      .from(workingHours)
      .innerJoin(locations, eq(workingHours.locationId, locations.id))
      .innerJoin(staff, eq(workingHours.staffId, staff.id))
      .where(
        and(
          isAny ? eq(staff.isActive, 1) : eq(workingHours.staffId, staffId),
          eq(workingHours.isEnabled, 1),
          eq(locations.isActive, 1),
        ),
      )
      .orderBy(asc(locations.createdAt), asc(locations.name));

    return rows;
  });
}

export async function createLocation(data: {
  name: string;
  address?: string | null;
  isActive?: number;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createLocationSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const [location] = await withTenantDb(slug, async (db, { locations }) => {
      return db
        .insert(locations)
        .values({
          name: parsed.data.name.trim(),
          address: parsed.data.address?.trim() || null,
          isActive: parsed.data.isActive ?? 1,
        })
        .returning({ id: locations.id });
    });

    revalidatePath("/settings/locations");
    revalidatePath("/settings/hours");
    revalidatePath("/schedule");
    trackEvent("location.created", {}, { tenantSlug: slug });
    return { success: true as const, id: location.id };
  } catch {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to create location",
      },
    };
  }
}

export async function updateLocation(data: {
  id: string;
  name?: string;
  address?: string | null;
  isActive?: number;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateLocationSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const { id, ...updates } = parsed.data;
    const result = await withTenantDb(slug, async (db, { locations }) => {
      return db
        .update(locations)
        .set({
          ...updates,
          address:
            typeof updates.address === "string"
              ? updates.address.trim() || null
              : updates.address,
          updatedAt: new Date(),
        })
        .where(eq(locations.id, id))
        .returning({ id: locations.id });
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Location not found",
        },
      };
    }

    revalidatePath("/settings/locations");
    revalidatePath("/settings/hours");
    revalidatePath("/schedule");
    trackEvent("location.updated", {}, { tenantSlug: slug });
    return { success: true as const, id: result[0].id };
  } catch {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to update location",
      },
    };
  }
}

/**
 * For each active staff member, list any active locations the staff member has NO
 * enabled working hours at. Used to surface "missing coverage" warnings on
 * Settings → Locations and Settings → Hours so owners notice when adding a
 * new location doesn't make it bookable until per-staff hours exist.
 *
 * Returns an empty list when the business has only one active location (no
 * coverage problem possible) or when every active staff member covers everything.
 */
export async function getLocationCoverageGaps(): Promise<
  Array<{
    staffId: string;
    staffName: string;
    locationId: string;
    locationName: string;
  }>
> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { staff, locations, workingHours }) => {
    const activeLocs = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.isActive, 1));

    if (activeLocs.length < 2) return [];

    const activeStaff = await db
      .select({
        id: staff.id,
        displayName: staff.displayName,
        role: staff.role,
      })
      .from(staff)
      .where(and(eq(staff.isActive, 1)));

    // Only non-assistant (provider) rows surface in booking — assistants don't take public
    // bookings, so missing-coverage warnings for them would be noise.
    const bookingStaff = activeStaff.filter((s) => s.role !== "assistant");
    if (bookingStaff.length === 0) return [];

    const enabled = await db
      .select({
        staffId: workingHours.staffId,
        locationId: workingHours.locationId,
      })
      .from(workingHours)
      .where(eq(workingHours.isEnabled, 1));

    const coverage = new Set<string>();
    for (const row of enabled) {
      if (row.locationId) coverage.add(`${row.staffId}:${row.locationId}`);
    }

    const gaps: Array<{
      staffId: string;
      staffName: string;
      locationId: string;
      locationName: string;
    }> = [];
    for (const s of bookingStaff) {
      for (const l of activeLocs) {
        if (!coverage.has(`${s.id}:${l.id}`)) {
          gaps.push({
            staffId: s.id,
            staffName: s.displayName,
            locationId: l.id,
            locationName: l.name,
          });
        }
      }
    }
    return gaps;
  });
}
