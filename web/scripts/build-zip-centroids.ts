/**
 * Builds data/geo/us-zip-centroids.csv from the US Census Gazetteer ZCTA file (public domain).
 *
 *   curl -O https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip
 *   unzip 2024_Gaz_zcta_national.zip -d gaz
 *   npx tsx scripts/build-zip-centroids.ts gaz/2024_Gaz_zcta_national.txt
 *
 * Output columns: zip,lat,lng (5 decimals, sorted by zip).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Pure: Gazetteer text (tab separated; GEOID, INTPTLAT, INTPTLONG) -> CSV text. */
export function buildCentroidCsv(gazetteer: string): string {
  const lines = gazetteer.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0].split("\t").map((h) => h.trim());
  const iZip = header.indexOf("GEOID");
  const iLat = header.indexOf("INTPTLAT");
  const iLng = header.indexOf("INTPTLONG");
  if (iZip < 0 || iLat < 0 || iLng < 0) {
    throw new Error("Expected tab-separated columns GEOID, INTPTLAT and INTPTLONG");
  }
  const rows = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const cols = line.split("\t").map((c) => c.trim());
    const zip = cols[iZip];
    const lat = Number(cols[iLat]);
    const lng = Number(cols[iLng]);
    if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.set(zip, `${zip},${lat.toFixed(5)},${lng.toFixed(5)}`);
  }
  const sorted = [...rows.keys()].sort();
  return ["zip,lat,lng", ...sorted.map((z) => rows.get(z)!)].join("\n") + "\n";
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npx tsx scripts/build-zip-centroids.ts <path to Gazetteer .txt>");
    process.exit(1);
  }
  const csv = buildCentroidCsv(readFileSync(input, "utf8"));
  const out = path.join(process.cwd(), "data/geo/us-zip-centroids.csv");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, csv);
  console.log(`Wrote ${csv.split("\n").length - 2} ZIP centroids to ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
