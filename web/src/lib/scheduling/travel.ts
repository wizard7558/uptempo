import type { LatLng } from "./types";

const EARTH_RADIUS_KM = 6371;
/** Road distance is estimated as straight-line distance times this factor. */
export const ROAD_FACTOR = 1.4;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Travel minutes = haversine x 1.4 / speed x 60, rounded up to a 5-minute step.
 * Returns Infinity when the speed is not positive and the points differ.
 */
export function estimateTravelMinutes(a: LatLng, b: LatLng, speedKmh: number): number {
  const km = haversineKm(a, b) * ROAD_FACTOR;
  if (km === 0) return 0;
  if (!(speedKmh > 0)) return Infinity;
  const minutes = (km / speedKmh) * 60;
  // Guard against float noise such as 15.000000000000002 rounding up to 20.
  return Math.ceil(Math.round(minutes * 1e6) / 1e6 / 5) * 5;
}
