import { normalizePostal } from "@/lib/geo/normalize";
import { haversineKm } from "@/lib/scheduling/travel";
import type { LatLng } from "@/lib/scheduling/types";

export type AreaRow = {
  id: string;
  /** null = the whole business. */
  staffId: string | null;
  kind: "postal_codes" | "radius";
  postalCodes: string[];
  centerLat: number | null;
  centerLng: number | null;
  radiusKm: number | null;
};

/** Does one area include this postal code / point? Radius areas need a point. */
export function areaCovers(a: AreaRow, postal: string, point: LatLng | null): boolean {
  if (a.kind === "postal_codes") {
    const wanted = normalizePostal(postal);
    return a.postalCodes.some((z) => normalizePostal(z) === wanted);
  }
  if (!point || a.centerLat == null || a.centerLng == null || a.radiusKm == null) return false;
  return haversineKm(point, { lat: a.centerLat, lng: a.centerLng }) <= a.radiusKm;
}

/**
 * No areas at all means every address is allowed. Otherwise the address must fall in
 * at least one area that applies to the staff member (business-wide areas, plus that
 * person's own). With no staff member, every area is considered.
 */
export function checkServiceArea(
  areas: AreaRow[],
  postal: string,
  point: LatLng | null,
  staffId: string | null,
): "ok" | "out_of_area" {
  if (areas.length === 0) return "ok";
  const relevant = areas.filter((a) => staffId === null || a.staffId === null || a.staffId === staffId);
  return relevant.some((a) => areaCovers(a, postal, point)) ? "ok" : "out_of_area";
}
