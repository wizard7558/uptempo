"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { withTenantDb } from "@/lib/db/tenant";
import { setOverrideSchema, removeOverrideSchema } from "@/lib/validators/override";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";

export async function setDurationOverride(data: {
  clientId: string;
  serviceId: string;
  durationMinutes?: number | null;
  priceCents?: number | null;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = setOverrideSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    await withTenantDb(slug, async (db, { clientServiceOverrides }) => {
      await db
        .insert(clientServiceOverrides)
        .values({
          clientId: parsed.data.clientId,
          serviceId: parsed.data.serviceId,
          durationMinutes: parsed.data.durationMinutes ?? null,
          priceCents: parsed.data.priceCents ?? null,
        })
        .onConflictDoUpdate({
          target: [clientServiceOverrides.clientId, clientServiceOverrides.serviceId],
          set: {
            durationMinutes: parsed.data.durationMinutes ?? null,
            priceCents: parsed.data.priceCents ?? null,
            updatedAt: new Date(),
          },
        });
    });

    trackEvent(
      "override.created",
      {
        clientId: parsed.data.clientId,
        serviceId: parsed.data.serviceId,
        durationMinutes: parsed.data.durationMinutes ?? null,
        priceCents: parsed.data.priceCents ?? null,
      },
      { tenantSlug: slug },
    );

    revalidatePath("/services");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: { formErrors: [], fieldErrors: {}, message: "Failed to save client override" },
    };
  }
}

export async function removeDurationOverride(data: {
  clientId: string;
  serviceId: string;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = removeOverrideSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {
    await withTenantDb(slug, async (db, { clientServiceOverrides }) => {
      await db
        .delete(clientServiceOverrides)
        .where(
          and(
            eq(clientServiceOverrides.clientId, parsed.data.clientId),
            eq(clientServiceOverrides.serviceId, parsed.data.serviceId)
          )
        );
    });

    trackEvent("override.deleted", { clientId: parsed.data.clientId, serviceId: parsed.data.serviceId }, { tenantSlug: slug });

    revalidatePath("/services");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: { formErrors: [], fieldErrors: {}, message: "Failed to remove client override" },
    };
  }
}

export async function getClientOverrides(clientId: string) {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { clientServiceOverrides, services }) => {
    return db
      .select({
        serviceId: clientServiceOverrides.serviceId,
        serviceName: services.name,
        defaultDurationMinutes: services.defaultDurationMinutes,
        defaultPriceCents: services.priceCents,
        overrideDurationMinutes: clientServiceOverrides.durationMinutes,
        overridePriceCents: clientServiceOverrides.priceCents,
      })
      .from(clientServiceOverrides)
      .innerJoin(services, eq(clientServiceOverrides.serviceId, services.id))
      .where(eq(clientServiceOverrides.clientId, clientId));
  });
}
