"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { getT } from "@/lib/terms/server";
import { withTenantDb } from "@/lib/db/tenant";
import {
  setStaffServiceSchema,
  removeStaffServiceSchema,
  bulkSetStaffOfferingsSchema,
} from "@/lib/validators/staff-service";
import { createServiceSchema } from "@/lib/validators/service";
import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";

export interface StaffServiceMatrixRow {
  serviceId: string;
  serviceName: string;
  category: string;
  description: string | null;
  defaultDurationMinutes: number;
  defaultPriceCents: number | null;
  defaultActiveMinutes: number | null;
  defaultProcessingMinutes: number | null;
  /** True when a staff_services row exists at all (offered or hidden). */
  isLinked: boolean;
  isOffered: boolean;
  customName: string | null;
  overridePriceCents: number | null;
  overrideDurationMinutes: number | null;
  overrideActiveMinutes: number | null;
  overrideProcessingMinutes: number | null;
}

/**
 * Returns every active catalog service joined with the staff member's existing
 * link row (if any). Drives the per-staff services management UI.
 */
export async function getStaffServiceMatrix(
  staffId: string,
): Promise<StaffServiceMatrixRow[]> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { services, staffServices }) => {
    const allServices = await db
      .select()
      .from(services)
      .where(eq(services.isActive, 1))
      .orderBy(asc(services.name));

    const links = await db
      .select()
      .from(staffServices)
      .where(eq(staffServices.staffId, staffId));

    const linkByService = new Map(links.map((l) => [l.serviceId, l]));

    return allServices.map((svc) => {
      const link = linkByService.get(svc.id);
      return {
        serviceId: svc.id,
        serviceName: svc.name,
        category: svc.category,
        description: svc.description,
        defaultDurationMinutes: svc.defaultDurationMinutes,
        defaultPriceCents: svc.priceCents,
        defaultActiveMinutes: svc.activeMinutes,
        defaultProcessingMinutes: svc.processingMinutes,
        isLinked: !!link,
        isOffered: link?.isOffered === 1,
        customName: link?.customName ?? null,
        overridePriceCents: link?.priceCents ?? null,
        overrideDurationMinutes: link?.durationMinutes ?? null,
        overrideActiveMinutes: link?.activeMinutes ?? null,
        overrideProcessingMinutes: link?.processingMinutes ?? null,
      };
    });
  });
}

/**
 * Upserts a staff member's offering for a service. Pass null on any override
 * field to clear it (revert to catalog default). Setting `isOffered: false`
 * hides the service from the public booking flow without unlinking.
 */
export async function setStaffServiceOffering(data: {
  staffId: string;
  serviceId: string;
  priceCents?: number | null;
  durationMinutes?: number | null;
  activeMinutes?: number | null;
  processingMinutes?: number | null;
  customName?: string | null;
  isOffered?: boolean;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = setStaffServiceSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    await withTenantDb(slug, async (db, { staffServices }) => {
      await db
        .insert(staffServices)
        .values({
          staffId: parsed.data.staffId,
          serviceId: parsed.data.serviceId,
          priceCents: parsed.data.priceCents ?? null,
          durationMinutes: parsed.data.durationMinutes ?? null,
          activeMinutes: parsed.data.activeMinutes ?? null,
          processingMinutes: parsed.data.processingMinutes ?? null,
          customName: parsed.data.customName ?? null,
          isOffered: parsed.data.isOffered === false ? 0 : 1,
        })
        .onConflictDoUpdate({
          target: [staffServices.staffId, staffServices.serviceId],
          set: {
            priceCents: parsed.data.priceCents ?? null,
            durationMinutes: parsed.data.durationMinutes ?? null,
            activeMinutes: parsed.data.activeMinutes ?? null,
            processingMinutes: parsed.data.processingMinutes ?? null,
            customName: parsed.data.customName ?? null,
            isOffered: parsed.data.isOffered === false ? 0 : 1,
            updatedAt: new Date(),
          },
        });
    });

    revalidatePath("/settings/staff");
    revalidatePath(`/settings/staff/${parsed.data.staffId}/services`);
    revalidatePath("/services");
    revalidatePath("/schedule");
    trackEvent(
      "stylist_service.set",
      {
        staffId: parsed.data.staffId,
        serviceId: parsed.data.serviceId,
        hasPriceOverride: parsed.data.priceCents != null,
        hasDurationOverride: parsed.data.durationMinutes != null,
        isOffered: parsed.data.isOffered !== false,
      },
      { tenantSlug: slug },
    );
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: (await getT("errors"))("staffServices.saveFailed"),
      },
    };
  }
}

/**
 * Hard-removes the link entirely. Use this when a staff member truly never offers
 * a service. Booking history is preserved because `appointment_services`
 * holds its own snapshot.
 */
export async function removeStaffServiceOffering(data: {
  staffId: string;
  serviceId: string;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = removeStaffServiceSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    await withTenantDb(slug, async (db, { staffServices }) => {
      await db
        .delete(staffServices)
        .where(
          and(
            eq(staffServices.staffId, parsed.data.staffId),
            eq(staffServices.serviceId, parsed.data.serviceId),
          ),
        );
    });

    revalidatePath("/settings/staff");
    revalidatePath(`/settings/staff/${parsed.data.staffId}/services`);
    revalidatePath("/services");
    revalidatePath("/schedule");
    trackEvent(
      "stylist_service.removed",
      {
        staffId: parsed.data.staffId,
        serviceId: parsed.data.serviceId,
      },
      { tenantSlug: slug },
    );
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: { message: (await getT("errors"))("staffServices.removeFailed") },
    };
  }
}

/**
 * Replace the set of services a staff member offers in one call.
 *
 * - Services in `serviceIds` not yet linked: inserted with all defaults
 *   (no overrides), `is_offered = 1`.
 * - Services not in `serviceIds`: link is deleted entirely (any per-staff
 *   overrides on those services are dropped).
 *
 * Existing links remain untouched (their overrides are preserved).
 */
export async function bulkSetStaffOfferings(data: {
  staffId: string;
  serviceIds: string[];
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = bulkSetStaffOfferingsSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    const desired = new Set(parsed.data.serviceIds);

    await withTenantDb(slug, async (db, { staffServices }) => {
      await db.transaction(async (tx) => {
        const existing = await tx
          .select({ serviceId: staffServices.serviceId })
          .from(staffServices)
          .where(eq(staffServices.staffId, parsed.data.staffId));

        const existingSet = new Set(existing.map((r) => r.serviceId));

        const toInsert = [...desired].filter((id) => !existingSet.has(id));
        const toDelete = [...existingSet].filter((id) => !desired.has(id));

        if (toInsert.length > 0) {
          await tx
            .insert(staffServices)
            .values(
              toInsert.map((serviceId) => ({
                staffId: parsed.data.staffId,
                serviceId,
              })),
            )
            .onConflictDoNothing();
        }

        if (toDelete.length > 0) {
          await tx
            .delete(staffServices)
            .where(
              and(
                eq(staffServices.staffId, parsed.data.staffId),
                inArray(staffServices.serviceId, toDelete),
              ),
            );
        }
      });
    });

    revalidatePath("/settings/staff");
    revalidatePath(`/settings/staff/${parsed.data.staffId}/services`);
    revalidatePath("/services");
    revalidatePath("/schedule");
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: (await getT("errors"))("staffServices.updateFailed"),
      },
    };
  }
}

/**
 * Creates a business-catalog service and links it ONLY to the given staff member.
 * Use this for services unique to a single staff member; it skips the auto-link
 * to all staff members that the catalog `createService` action performs.
 *
 * The service still lives on the business catalog (so it can be shared later
 * by linking other staff members), but starts owned by exactly one staff member.
 */
export async function createCustomServiceForStaffMember(data: {
  staffId: string;
  name: string;
  description?: string | null;
  defaultDurationMinutes: number;
  priceCents?: number | null;
  costCents?: number | null;
  category?: string;
  activeMinutes?: number | null;
  processingMinutes?: number | null;
  assistantWorkflow?: number;
  assistantTaskTypeId?: string | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsedService = createServiceSchema.safeParse({
    name: data.name,
    description: data.description,
    defaultDurationMinutes: data.defaultDurationMinutes,
    priceCents: data.priceCents,
    costCents: data.costCents,
    category: data.category,
    activeMinutes: data.activeMinutes,
    processingMinutes: data.processingMinutes,
    assistantWorkflow: data.assistantWorkflow,
    assistantTaskTypeId: data.assistantTaskTypeId,
  });
  if (!parsedService.success) {
    return { success: false as const, error: parsedService.error.flatten() };
  }
  if (
    !data.staffId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data.staffId,
    )
  ) {
    const invalidIdMessage = (await getT("errors"))("staffServices.invalidId");
    return {
      success: false as const,
      error: {
        formErrors: [invalidIdMessage],
        fieldErrors: {},
        message: invalidIdMessage,
      },
    };
  }

  try {
    const serviceId = await withTenantDb(
      slug,
      async (db, { services, staffServices }) => {
        return db.transaction(async (tx) => {
          const [created] = await tx
            .insert(services)
            .values({
              name: parsedService.data.name,
              description: parsedService.data.description ?? null,
              defaultDurationMinutes: parsedService.data.defaultDurationMinutes,
              priceCents: parsedService.data.priceCents ?? null,
              costCents: parsedService.data.costCents ?? null,
              category: parsedService.data.category,
              activeMinutes: parsedService.data.activeMinutes ?? null,
              processingMinutes: parsedService.data.processingMinutes ?? null,
              assistantWorkflow: parsedService.data.assistantWorkflow ?? 0,
              assistantTaskTypeId:
                parsedService.data.assistantTaskTypeId ?? null,
            })
            .returning({ id: services.id });

          await tx.insert(staffServices).values({
            staffId: data.staffId,
            serviceId: created.id,
          });

          return created.id;
        });
      },
    );

    revalidatePath("/services");
    revalidatePath("/settings/staff");
    revalidatePath(`/settings/staff/${data.staffId}/services`);
    revalidatePath("/schedule");
    trackEvent(
      "stylist_service.custom_created",
      { staffId: data.staffId },
      { tenantSlug: slug },
    );
    return { success: true as const, id: serviceId };
  } catch {
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to create custom service",
      },
    };
  }
}

/**
 * Returns count of staff members offering each service. Powers the "X staff members
 * offer this" column on the catalog page.
 */
export async function getStaffOfferingCounts(): Promise<
  Record<string, number>
> {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { staffServices, staff }) => {
    const rows = await db
      .select({
        serviceId: staffServices.serviceId,
        staffId: staffServices.staffId,
        isOffered: staffServices.isOffered,
        isActive: staff.isActive,
      })
      .from(staffServices)
      .innerJoin(staff, eq(staffServices.staffId, staff.id));

    const counts: Record<string, number> = {};
    for (const r of rows) {
      if (r.isOffered === 1 && r.isActive === 1) {
        counts[r.serviceId] = (counts[r.serviceId] ?? 0) + 1;
      }
    }
    return counts;
  });
}
