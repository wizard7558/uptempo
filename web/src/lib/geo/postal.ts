import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LatLng } from "@/lib/scheduling/types";
import { normalizePostal } from "./normalize";

export { normalizePostal };

/**
 * Postal-code helpers for on-site visits. US ZIP codes resolve to a centroid from
 * data/geo/us-zip-centroids.csv (US Census Gazetteer, public domain). Other countries
 * get no centroid; owners enter a manual pin instead.
 */

let table: Promise<Map<string, LatLng>> | null = null;

export function parseCentroidCsv(csv: string): Map<string, LatLng> {
  const map = new Map<string, LatLng>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [zip, lat, lng] = line.split(",");
    if (!zip || !lat || !lng) continue;
    map.set(zip, { lat: Number(lat), lng: Number(lng) });
  }
  return map;
}

function loadTable(): Promise<Map<string, LatLng>> {
  if (!table) {
    table = readFile(path.join(process.cwd(), "data/geo/us-zip-centroids.csv"), "utf8")
      .then(parseCentroidCsv)
      .catch((err) => {
        table = null; // retry on the next call instead of caching the failure
        throw err;
      });
  }
  return table;
}

export async function lookupPostalCentroid(code: string, country = "US"): Promise<LatLng | null> {
  if (country.toUpperCase() !== "US") return null;
  const zip = normalizePostal(code, "US");
  if (!/^\d{5}$/.test(zip)) return null;
  return (await loadTable()).get(zip) ?? null;
}

/** The ZIP whose centroid is closest to `point` (used to label a radius area's center). */
export async function nearestPostal(point: LatLng): Promise<string | null> {
  let best: string | null = null;
  let bestD = Infinity;
  for (const [zip, p] of await loadTable()) {
    const d = (p.lat - point.lat) ** 2 + ((p.lng - point.lng) * Math.cos((point.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = zip;
    }
  }
  return best;
}
