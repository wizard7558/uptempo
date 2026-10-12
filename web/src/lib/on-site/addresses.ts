import { count, eq } from "drizzle-orm";
import { z } from "zod";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { withTenantDb } from "@/lib/db/tenant";
import { lookupPostalCentroid, normalizePostal } from "@/lib/geo/postal";
import type { LatLng } from "@/lib/scheduling/types";
import { checkServiceArea } from "./service-area";
import { loadActiveAreas } from "./areas";

/** The five address fields shared by the request form and the booking wizard. */
export const addressInputSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(50),
  postalCode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,10}$/),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

export type AreaVerdict = { zip: string; point: LatLng | null; result: "ok" | "out_of_area" };

/** Looks up the ZIP centroid and checks it against the business's (or one staff member's) areas. */
export async function judgeAddress(
  slug: string,
  postalCode: string,
  staffId: string | null,
): Promise<AreaVerdict> {
  const zip = normalizePostal(postalCode);
  const [point, areas] = await Promise.all([lookupPostalCentroid(zip), loadActiveAreas(slug)]);
  return { zip, point, result: checkServiceArea(areas, zip, point, staffId) };
}

type AddressDb = Pick<PostgresJsDatabase<Record<string, unknown>>, "select" | "insert">;
type AddressTable = ReturnType<typeof import("@/lib/db/tenant-schema/tables").createTenantTables>["clientAddresses"];

/** Writes the address row on the given connection (so a caller can do it inside its own transaction). */
export async function insertAddressRow(
  db: AddressDb,
  clientAddresses: AddressTable,
  clientId: string,
  addr: AddressInput,
  point: LatLng | null,
): Promise<string> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(clientAddresses)
    .where(eq(clientAddresses.clientId, clientId));
  const [row] = await db
    .insert(clientAddresses)
    .values({
      clientId,
      line1: addr.line1,
      line2: addr.line2 || null,
      city: addr.city,
      region: addr.region,
      postalCode: normalizePostal(addr.postalCode),
      country: "US",
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      geoSource: point ? "postal_centroid" : null,
      isDefault: n === 0 ? 1 : 0,
    })
    .returning({ id: clientAddresses.id });
  return row.id;
}

/** Saves an address for a client. It becomes the default when it is the client's first. */
export async function insertClientAddress(
  slug: string,
  clientId: string,
  addr: AddressInput,
  point: LatLng | null,
): Promise<string> {
  return withTenantDb(slug, async (db, { clientAddresses }) =>
    insertAddressRow(db, clientAddresses, clientId, addr, point),
  );
}
