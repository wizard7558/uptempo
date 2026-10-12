import {
  resolveServicePricing,
  type ResolvedServicePricing,
} from "./resolve-pricing";

/**
 * Backwards-compatible legacy shape consumed by booking flows and UI.
 * Maps the resolver's richer output back onto the existing field names.
 */
export interface ServiceDurationInfo {
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  isOverride: boolean;
  priceCents: number;
  isPriceOverride: boolean;
  category: string;
  activeMinutes: number | null;
  processingMinutes: number | null;
  /** Source of the duration: "client", "stylist", or "service". */
  durationSource: ResolvedServicePricing["durationSource"];
  /** Source of the price: "client", "stylist", or "service". */
  priceSource: ResolvedServicePricing["priceSource"];
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

/**
 * Returns per-service duration / price breakdown using the full
 * client → stylist → service catalog resolution chain.
 *
 * `stylistId` is optional: when omitted, only client overrides and catalog
 * defaults are considered. Existing callers without stylist context still
 * work, and they'll start picking up stylist overrides as soon as they pass
 * the stylist along.
 */
export async function getMultiServiceDuration(
  serviceIds: string[],
  clientId: string | null,
  staffId: string | null = null,
  slug?: string,
): Promise<{ services: ServiceDurationInfo[]; totalMinutes: number }> {
  const result = await resolveServicePricing(serviceIds, clientId, staffId, slug);
  return {
    services: result.services.map((r) => ({
      serviceId: r.serviceId,
      serviceName: r.serviceName,
      durationMinutes: r.durationMinutes,
      isOverride: r.isOverride,
      priceCents: r.priceCents,
      isPriceOverride: r.isPriceOverride,
      category: r.category,
      activeMinutes: r.activeMinutes,
      processingMinutes: r.processingMinutes,
      durationSource: r.durationSource,
      priceSource: r.priceSource,
      priceDisplay: r.priceDisplay,
      onlineBookable: r.onlineBookable,
      bookingAudience: r.bookingAudience,
      depositType: r.depositType,
      depositAmount: r.depositAmount,
    })),
    totalMinutes: result.totalMinutes,
  };
}
