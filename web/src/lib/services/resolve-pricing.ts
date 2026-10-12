import { eq, and, inArray } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";

/**
 * Source layers, ordered from highest to lowest priority.
 * The resolver picks the first non-null value for each field.
 */
export type ResolutionSource = "client" | "stylist" | "service";

export interface ResolvedServicePricing {
  serviceId: string;
  /** Display name (stylist customName takes precedence over catalog name). */
  serviceName: string;
  category: string;
  durationMinutes: number;
  priceCents: number;
  activeMinutes: number | null;
  processingMinutes: number | null;
  durationSource: ResolutionSource;
  priceSource: ResolutionSource;
  /** Convenience: true if EITHER duration or price was overridden from catalog. */
  isOverride: boolean;
  /** True if price specifically came from an override (client or stylist). */
  isPriceOverride: boolean;
  /** True if the stylist has hidden this service (is_offered = 0). */
  isHiddenByStaffMember: boolean;
  /** Catalog: how the price renders to clients ('show' | 'starting' | 'hidden'). */
  priceDisplay: string;
  /** Catalog: 0 = internal-only (not self-bookable online). */
  onlineBookable: number;
  /** Catalog: who may self-book online ('all' | 'new' | 'returning'). */
  bookingAudience: string;
  /** Catalog: per-service deposit override (null = inherit salon rule). */
  depositType: string | null;
  depositAmount: number | null;
}

export interface ResolvedPricingResult {
  services: ResolvedServicePricing[];
  totalMinutes: number;
  totalCents: number;
}

/**
 * Resolves the effective price, duration, and processing-time split for a set
 * of services using a three-layer priority chain:
 *
 *   client_service_overrides  >  stylist_services overrides  >  services defaults
 *
 * Each field resolves independently — a client override on price doesn't
 * affect duration if no client duration override exists. Pass `null` for
 * either client or stylist to skip that layer.
 */
export async function resolveServicePricing(
  serviceIds: string[],
  clientId: string | null,
  staffId: string | null,
  slugOverride?: string,
): Promise<ResolvedPricingResult> {
  if (serviceIds.length === 0) {
    return { services: [], totalMinutes: 0, totalCents: 0 };
  }

  const slug = slugOverride ?? (await getTenantSlug());
  return withTenantDb(
    slug,
    async (
      db,
      { services, clientServiceOverrides, staffServices },
    ) => {
      const serviceRows = await db
        .select({
          id: services.id,
          name: services.name,
          defaultDurationMinutes: services.defaultDurationMinutes,
          priceCents: services.priceCents,
          category: services.category,
          activeMinutes: services.activeMinutes,
          processingMinutes: services.processingMinutes,
          priceDisplay: services.priceDisplay,
          onlineBookable: services.onlineBookable,
          bookingAudience: services.bookingAudience,
          depositType: services.depositType,
          depositAmount: services.depositAmount,
        })
        .from(services)
        .where(inArray(services.id, serviceIds));

      const clientOverrides = clientId
        ? await db
            .select({
              serviceId: clientServiceOverrides.serviceId,
              durationMinutes: clientServiceOverrides.durationMinutes,
              priceCents: clientServiceOverrides.priceCents,
              activeMinutes: clientServiceOverrides.activeMinutes,
              processingMinutes: clientServiceOverrides.processingMinutes,
            })
            .from(clientServiceOverrides)
            .where(
              and(
                eq(clientServiceOverrides.clientId, clientId),
                inArray(clientServiceOverrides.serviceId, serviceIds),
              ),
            )
        : [];

      const staffOverrides = staffId
        ? await db
            .select({
              serviceId: staffServices.serviceId,
              durationMinutes: staffServices.durationMinutes,
              priceCents: staffServices.priceCents,
              activeMinutes: staffServices.activeMinutes,
              processingMinutes: staffServices.processingMinutes,
              customName: staffServices.customName,
              isOffered: staffServices.isOffered,
            })
            .from(staffServices)
            .where(
              and(
                eq(staffServices.staffId, staffId),
                inArray(staffServices.serviceId, serviceIds),
              ),
            )
        : [];

      const clientMap = new Map(clientOverrides.map((o) => [o.serviceId, o]));
      const staffMap = new Map(staffOverrides.map((o) => [o.serviceId, o]));

      const resolved: ResolvedServicePricing[] = serviceRows.map((svc) => {
        const c = clientMap.get(svc.id);
        const s = staffMap.get(svc.id);

        const pickDuration = pickWithSource(
          c?.durationMinutes,
          s?.durationMinutes,
          svc.defaultDurationMinutes,
        );
        const pickPrice = pickWithSource(
          c?.priceCents,
          s?.priceCents,
          svc.priceCents ?? 0,
        );
        const pickActive = pickWithSource(
          c?.activeMinutes,
          s?.activeMinutes,
          svc.activeMinutes,
        );
        const pickProcessing = pickWithSource(
          c?.processingMinutes,
          s?.processingMinutes,
          svc.processingMinutes,
        );

        return {
          serviceId: svc.id,
          serviceName: s?.customName ?? svc.name,
          category: svc.category,
          durationMinutes: pickDuration.value,
          priceCents: pickPrice.value,
          activeMinutes: pickActive.value,
          processingMinutes: pickProcessing.value,
          durationSource: pickDuration.source,
          priceSource: pickPrice.source,
          isOverride:
            pickDuration.source !== "service" ||
            pickPrice.source !== "service",
          isPriceOverride: pickPrice.source !== "service",
          isHiddenByStaffMember: s?.isOffered === 0,
          priceDisplay: svc.priceDisplay ?? "show",
          onlineBookable: svc.onlineBookable ?? 1,
          bookingAudience: svc.bookingAudience ?? "all",
          depositType: svc.depositType ?? null,
          depositAmount: svc.depositAmount ?? null,
        };
      });

      return {
        services: resolved,
        totalMinutes: resolved.reduce((sum, r) => sum + r.durationMinutes, 0),
        totalCents: resolved.reduce((sum, r) => sum + r.priceCents, 0),
      };
    },
  );
}

function pickWithSource<T>(
  client: T | null | undefined,
  staffMember: T | null | undefined,
  fallback: T,
): { value: T; source: ResolutionSource } {
  if (client != null) return { value: client, source: "client" };
  if (staffMember != null) return { value: staffMember, source: "stylist" };
  return { value: fallback, source: "service" };
}
