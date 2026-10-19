"use server";

import { withTenantDb } from "@/lib/db/tenant";
import { createServiceSchema, updateServiceSchema } from "@/lib/validators/service";
import { getMultiServiceDuration as _getMultiServiceDuration } from "@/lib/services/duration";
import {
  SERVICE_PRESETS,
  filterUnusedPresets,
  type ServicePreset,
} from "@/lib/services/preset-catalog";
import { eq, and, asc } from "drizzle-orm";
import { AuthError, requireRole, requireStaff } from "@/lib/auth/rbac";
import {
  setServiceNeedsSchema,
  type ServiceNeedInput,
} from "@/lib/validators/resource";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";

export async function createService(data: {
  name: string;
  description?: string | null;
  defaultDurationMinutes: number;
  priceCents?: number | null;
  costCents?: number | null;
  category?: string;
  onlineBookable?: number;
  bookingAudience?: "all" | "new" | "returning";
  priceDisplay?: "show" | "starting" | "hidden";
  depositType?: "none" | "percent" | "fixed" | null;
  depositAmount?: number | null;
  activeMinutes?: number | null;
  processingMinutes?: number | null;
  assistantWorkflow?: number;
  assistantTaskTypeId?: string | null;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  minNoticeMin?: number | null;
  maxAdvanceDays?: number | null;
  slotIntervalMin?: number | null;
  locationType?: "in_studio" | "virtual" | "on_site";
  variantOfServiceId?: string | null;
  isClass?: number;
  classCapacity?: number | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = createServiceSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const service = await withTenantDb(
      slug,
      async (db, { services, staff, staffServices }) => {
        const [created] = await db
          .insert(services)
          .values({
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            defaultDurationMinutes: parsed.data.defaultDurationMinutes,
            priceCents: parsed.data.priceCents ?? null,
            costCents: parsed.data.costCents ?? null,
            category: parsed.data.category,
            onlineBookable: parsed.data.onlineBookable ?? 1,
            bookingAudience: parsed.data.bookingAudience ?? "all",
            priceDisplay: parsed.data.priceDisplay ?? "show",
            depositType: parsed.data.depositType ?? null,
            depositAmount: parsed.data.depositAmount ?? null,
            activeMinutes: parsed.data.activeMinutes ?? null,
            processingMinutes: parsed.data.processingMinutes ?? null,
            assistantWorkflow: parsed.data.assistantWorkflow ?? 0,
            assistantTaskTypeId: parsed.data.assistantTaskTypeId ?? null,
            bufferBeforeMin: parsed.data.bufferBeforeMin ?? 0,
            bufferAfterMin: parsed.data.bufferAfterMin ?? 0,
            minNoticeMin: parsed.data.minNoticeMin ?? null,
            maxAdvanceDays: parsed.data.maxAdvanceDays ?? null,
            slotIntervalMin: parsed.data.slotIntervalMin ?? null,
            locationType: parsed.data.locationType ?? "in_studio",
            variantOfServiceId: parsed.data.variantOfServiceId ?? null,
            isClass: parsed.data.isClass ?? 0,
            classCapacity: parsed.data.isClass === 1 ? (parsed.data.classCapacity ?? null) : null,
          })
          .returning({ id: services.id });

        // Auto-assign new service to every active stylist so it immediately
        // appears in the new-booking picker (which filters by stylist_services).
        const activeStaff = await db
          .select({ id: staff.id })
          .from(staff)
          .where(eq(staff.isActive, 1));

        if (activeStaff.length > 0) {
          await db
            .insert(staffServices)
            .values(
              activeStaff.map((s) => ({
                staffId: s.id,
                serviceId: created.id,
              })),
            )
            .onConflictDoNothing();
        }

        return created;
      },
    );

    revalidatePath("/services");
    revalidatePath("/schedule");
    trackEvent("service.created", {}, { tenantSlug: slug });
    return { success: true as const, id: service.id };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: { formErrors: [], fieldErrors: {}, message: "Failed to create service" },
    };
  }
}

export async function updateService(data: {
  id: string;
  name?: string;
  description?: string | null;
  defaultDurationMinutes?: number;
  priceCents?: number | null;
  costCents?: number | null;
  category?: string;
  onlineBookable?: number;
  bookingAudience?: "all" | "new" | "returning";
  priceDisplay?: "show" | "starting" | "hidden";
  depositType?: "none" | "percent" | "fixed" | null;
  depositAmount?: number | null;
  activeMinutes?: number | null;
  processingMinutes?: number | null;
  assistantWorkflow?: number;
  assistantTaskTypeId?: string | null;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  minNoticeMin?: number | null;
  maxAdvanceDays?: number | null;
  slotIntervalMin?: number | null;
  locationType?: "in_studio" | "virtual" | "on_site";
  variantOfServiceId?: string | null;
  isClass?: number;
  classCapacity?: number | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateServiceSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const { id, ...updates } = parsed.data;

    const result = await withTenantDb(slug, async (db, { services }) => {
      return db
        .update(services)
        .set({
          ...updates,
          ...(updates.isClass === 0 ? { classCapacity: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(services.id, id), eq(services.isActive, 1)))
        .returning({ id: services.id });
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: { formErrors: [], fieldErrors: {}, message: "Service not found or inactive" },
      };
    }

    revalidatePath("/services");
    trackEvent("service.updated", {}, { tenantSlug: slug });
    return { success: true as const, id: result[0].id };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: { formErrors: [], fieldErrors: {}, message: "Failed to update service" },
    };
  }
}

export async function deleteService(id: string) {
  const { tenantSlug: slug } = await requireStaff();
  try {
    const result = await withTenantDb(slug, async (db, { services }) => {
      return db
        .update(services)
        .set({ isActive: 0, updatedAt: new Date() })
        .where(eq(services.id, id))
        .returning({ id: services.id });
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: { message: "Service not found" },
      };
    }

    revalidatePath("/services");
    trackEvent("service.deleted", {}, { tenantSlug: slug });
    return { success: true as const };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: { message: "Failed to delete service" },
    };
  }
}

export async function listServices() {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { services }) => {
    return db
      .select()
      .from(services)
      .where(eq(services.isActive, 1))
      .orderBy(asc(services.name));
  });
}

/**
 * Server action wrapper for getMultiServiceDuration.
 * Pass stylistId so per-stylist price/duration overrides are applied.
 */
export async function fetchMultiServiceDuration(
  serviceIds: string[],
  clientId: string,
  staffId: string | null = null,
) {
  await requireStaff();
  return _getMultiServiceDuration(serviceIds, clientId, staffId);
}

/**
 * Returns the curated preset catalog filtered down to presets the salon
 * doesn't already have (matched case-insensitively on name).
 */
export async function listAvailablePresets(): Promise<ServicePreset[]> {
  const { tenantSlug: slug } = await requireStaff();
  const existing = await withTenantDb(slug, async (db, { services }) => {
    return db
      .select({ name: services.name })
      .from(services)
      .where(eq(services.isActive, 1));
  });
  return filterUnusedPresets(
    SERVICE_PRESETS,
    existing.map((s) => s.name),
  );
}

/**
 * Bulk-import a list of preset keys as new catalog services. Each created
 * service is auto-linked to all active stylists (matching the per-service
 * createService behaviour). Returns the created service IDs in the same
 * order as `keys`.
 */
export async function importServicePresets(keys: string[]) {
  const { tenantSlug: slug } = await requireStaff();
  if (keys.length === 0) return { success: true as const, ids: [] };

  const lookup = new Map(SERVICE_PRESETS.map((p) => [p.key, p]));
  const presets = keys.map((k) => lookup.get(k)).filter(
    (p): p is ServicePreset => !!p,
  );
  if (presets.length === 0) {
    return { success: false as const, error: { message: "No valid presets" } };
  }

  try {
    const ids = await withTenantDb(
      slug,
      async (db, { services, staff, staffServices }) => {
        return db.transaction(async (tx) => {
          const inserted = await tx
            .insert(services)
            .values(
              presets.map((p) => ({
                name: p.name,
                description: p.description,
                defaultDurationMinutes: p.defaultDurationMinutes,
                priceCents: p.suggestedPriceCents,
                category: p.category,
                activeMinutes: p.activeMinutes ?? null,
                processingMinutes: p.processingMinutes ?? null,
              })),
            )
            .returning({ id: services.id });

          const activeStaff = await tx
            .select({ id: staff.id })
            .from(staff)
            .where(eq(staff.isActive, 1));

          if (activeStaff.length > 0 && inserted.length > 0) {
            await tx
              .insert(staffServices)
              .values(
                activeStaff.flatMap((s) =>
                  inserted.map((svc) => ({
                    staffId: s.id,
                    serviceId: svc.id,
                  })),
                ),
              )
              .onConflictDoNothing();
          }

          return inserted.map((r) => r.id);
        });
      },
    );

    revalidatePath("/services");
    revalidatePath("/settings/staff");
    revalidatePath("/schedule");
    trackEvent(
      "service.presets_imported",
      { count: ids.length },
      { tenantSlug: slug },
    );
    return { success: true as const, ids };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return {
      success: false as const,
      error: { message: "Failed to import presets" },
    };
  }
}

export async function previewBookingPricing(
  serviceIds: string[],
  clientId: string,
  staffId: string | null = null,
) {
  await requireStaff();
  const result = await _getMultiServiceDuration(serviceIds, clientId, staffId);
  return {
    services: result.services.map((service) => ({
      serviceId: service.serviceId,
      serviceName: service.serviceName,
      priceCents: service.priceCents,
      isPriceOverride: service.isPriceOverride,
      priceSource: service.priceSource,
      category: service.category,
    })),
    totalCents: result.services.reduce(
      (sum, service) => sum + service.priceCents,
      0,
    ),
  };
}

/** What a service needs from rooms and equipment, in the order it was added. */
export async function getServiceNeeds(serviceId: string): Promise<ServiceNeedInput[]> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { serviceResourceRequirements: srr }) => {
    const rows = await db
      .select({
        resourceKind: srr.resourceKind,
        resourceId: srr.resourceId,
        quantity: srr.quantity,
        offsetMin: srr.offsetMin,
        durationMin: srr.durationMin,
      })
      .from(srr)
      .where(eq(srr.serviceId, serviceId))
      .orderBy(asc(srr.createdAt), asc(srr.id));
    return rows as ServiceNeedInput[];
  });
}

/** Needs of every service, keyed by service id (for the services page). */
export async function getAllServiceNeeds(): Promise<Record<string, ServiceNeedInput[]>> {
  const { tenantSlug: slug } = await requireStaff();
  const rows = await withTenantDb(slug, async (db, { serviceResourceRequirements: srr }) =>
    db
      .select({
        serviceId: srr.serviceId,
        resourceKind: srr.resourceKind,
        resourceId: srr.resourceId,
        quantity: srr.quantity,
        offsetMin: srr.offsetMin,
        durationMin: srr.durationMin,
      })
      .from(srr)
      .orderBy(asc(srr.createdAt), asc(srr.id)),
  );
  const out: Record<string, ServiceNeedInput[]> = {};
  for (const { serviceId, ...need } of rows) {
    (out[serviceId] ??= []).push(need as ServiceNeedInput);
  }
  return out;
}

/** Replaces everything a service needs (delete and insert in one transaction). */
export async function setServiceNeeds(
  serviceId: string,
  needs: ServiceNeedInput[],
): Promise<{ success: true } | { success: false; error: { message: string } }> {
  const session = await requireRole("owner", "admin");
  if (!session.tenantSlug) throw new AuthError("NO_TENANT", "No active business");
  const parsed = setServiceNeedsSchema.safeParse({ serviceId, needs });
  if (!parsed.success) {
    return { success: false, error: { message: "Invalid needs" } };
  }
  try {
  const slug = session.tenantSlug;
    await withTenantDb(slug, async (db, { serviceResourceRequirements: srr }) =>
      db.transaction(async (tx) => {
        await tx.delete(srr).where(eq(srr.serviceId, serviceId));
        if (parsed.data.needs.length > 0) {
          await tx
            .insert(srr)
            .values(parsed.data.needs.map((n) => ({ serviceId, ...n })));
        }
      }),
    );
    revalidatePath("/services");
    revalidatePath("/schedule");
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return { success: false, error: { message: "Failed to save needs" } };
  }
}
