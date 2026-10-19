"use server";

import { requireStaff } from "@/lib/auth/rbac";

import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { getMultiServiceDuration } from "@/lib/services/duration";
import { eq, and, asc, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export interface AddonOption {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  priceCents: number;
  priceDisplay: string;
}

/**
 * For a set of primary services, return each one's offered add-ons (resolved for
 * this client and staff member so prices and durations match what they'll be charged).
 * Returns a map keyed by primary serviceId.
 */
export async function getAddonsForServices(
  primaryServiceIds: string[],
  clientId: string | null,
  staffId: string | null = null,
): Promise<Record<string, AddonOption[]>> {
  if (primaryServiceIds.length === 0) return {};
  const sessionClientId = await getBookingSession();
  const trustedClientId = clientId && clientId === sessionClientId ? clientId : null;
  const slug = await getTenantSlug();

  const links = await withTenantDb(slug, async (db, { serviceAddons, services }) => {
    return db
      .select({
        primaryServiceId: serviceAddons.primaryServiceId,
        addonServiceId: serviceAddons.addonServiceId,
        sortOrder: serviceAddons.sortOrder,
      })
      .from(serviceAddons)
      .innerJoin(services, eq(services.id, serviceAddons.addonServiceId))
      // Only surface add-ons whose underlying service is still active.
      .where(
        and(
          inArray(serviceAddons.primaryServiceId, primaryServiceIds),
          eq(services.isActive, 1),
        ),
      )
      .orderBy(asc(serviceAddons.sortOrder));
  });

  if (links.length === 0) return {};

  // Resolve pricing/duration for every distinct add-on service once.
  const addonIds = Array.from(new Set(links.map((l) => l.addonServiceId)));
  const resolved = await getMultiServiceDuration(addonIds, trustedClientId, staffId);
  const byId = new Map(resolved.services.map((s) => [s.serviceId, s]));

  const out: Record<string, AddonOption[]> = {};
  for (const link of links) {
    const svc = byId.get(link.addonServiceId);
    if (!svc) continue;
    (out[link.primaryServiceId] ??= []).push({
      serviceId: svc.serviceId,
      serviceName: svc.serviceName,
      durationMinutes: svc.durationMinutes,
      priceCents: svc.priceCents,
      priceDisplay: svc.priceDisplay,
    });
  }
  return out;
}

/** Admin: full map of primaryServiceId → [addonServiceId] for the catalog page. */
export async function getAllServiceAddonsMap(): Promise<Record<string, string[]>> {
  const slug = await getTenantSlug();
  const rows = await withTenantDb(slug, async (db, { serviceAddons }) => {
    return db
      .select({
        primaryServiceId: serviceAddons.primaryServiceId,
        addonServiceId: serviceAddons.addonServiceId,
        sortOrder: serviceAddons.sortOrder,
      })
      .from(serviceAddons)
      .orderBy(asc(serviceAddons.sortOrder));
  });
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    (map[r.primaryServiceId] ??= []).push(r.addonServiceId);
  }
  return map;
}

/** Admin: list add-on links for a single primary service (with add-on names). */
export async function listServiceAddons(primaryServiceId: string) {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { serviceAddons, services }) => {
    return db
      .select({
        id: serviceAddons.id,
        addonServiceId: serviceAddons.addonServiceId,
        addonName: services.name,
        sortOrder: serviceAddons.sortOrder,
      })
      .from(serviceAddons)
      .innerJoin(services, eq(services.id, serviceAddons.addonServiceId))
      .where(eq(serviceAddons.primaryServiceId, primaryServiceId))
      .orderBy(asc(serviceAddons.sortOrder));
  });
}

const setAddonsSchema = z.object({
  primaryServiceId: z.string().uuid(),
  addonServiceIds: z.array(z.string().uuid()),
});

/**
 * Replace the full set of add-ons for a primary service. Rejects self-links.
 * Idempotent: it diffs against existing links so order/sort stays stable.
 */
export async function setServiceAddons(data: {
  primaryServiceId: string;
  addonServiceIds: string[];
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = setAddonsSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }
  const { primaryServiceId } = parsed.data;
  const addonServiceIds = parsed.data.addonServiceIds.filter(
    (id) => id !== primaryServiceId,
  );

  try {
    await withTenantDb(slug, async (db, { serviceAddons, services }) => {
      await db.transaction(async (tx) => {
        // Validate the add-ons reference real, active services in this tenant.
        if (addonServiceIds.length > 0) {
          const valid = await tx
            .select({ id: services.id })
            .from(services)
            .where(
              and(
                inArray(services.id, addonServiceIds),
                eq(services.isActive, 1),
                ne(services.id, primaryServiceId),
              ),
            );
          const validIds = new Set(valid.map((v) => v.id));
          const filtered = addonServiceIds.filter((id) => validIds.has(id));

          // Wipe and re-insert with deterministic sort order.
          await tx
            .delete(serviceAddons)
            .where(eq(serviceAddons.primaryServiceId, primaryServiceId));
          if (filtered.length > 0) {
            await tx.insert(serviceAddons).values(
              filtered.map((addonServiceId, i) => ({
                primaryServiceId,
                addonServiceId,
                sortOrder: (i + 1) * 10,
              })),
            );
          }
        } else {
          await tx
            .delete(serviceAddons)
            .where(eq(serviceAddons.primaryServiceId, primaryServiceId));
        }
      });
    });

    revalidatePath("/settings/services");
    revalidatePath("/services");
    return { success: true as const };
  } catch {
    return {
      success: false as const,
      error: { formErrors: ["Failed to save add-ons"], fieldErrors: {} },
    };
  }
}
