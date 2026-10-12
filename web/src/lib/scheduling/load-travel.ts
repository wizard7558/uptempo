/**
 * Loads the travel inputs for an on-site job: where the job is, where each staff
 * member starts the day, and the on-site jobs they already have nearby in time.
 * Server-only: never import this from client components.
 */
import { and, eq, inArray, isNotNull, notInArray, ne, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { wallClockToDate } from "./intervals";
import type { Travel } from "./types";

export type LoadTravelParams = {
  slug: string;
  staffIds: string[];
  fromDay: string;
  toDay: string;
  timezone: string;
  /** The `client_addresses` row where the job will happen. */
  addressId: string;
  excludeAppointmentIds?: string[];
};

/** Returns null when the address is unknown or has no coordinates (the ZIP wasn't found). */
export async function loadTravel(p: LoadTravelParams): Promise<Travel | null> {
  const rs = wallClockToDate(p.fromDay, "00:00", p.timezone);
  const re = wallClockToDate(p.toDay, "24:00", p.timezone);
  const range = sql`tstzrange(${rs.toISOString()}::timestamptz, ${re.toISOString()}::timestamptz, '[)')`;

  return withTenantDb(
    p.slug,
    async (db, { clientAddresses, staffTravelSettings, appointments, businessSettings }) => {
      const [job] = await db
        .select({ lat: clientAddresses.lat, lng: clientAddresses.lng })
        .from(clientAddresses)
        .where(eq(clientAddresses.id, p.addressId))
        .limit(1);
      if (!job || job.lat == null || job.lng == null) return null;
      if (p.staffIds.length === 0) {
        return { jobPoint: { lat: job.lat, lng: job.lng }, staffBase: {}, neighbors: [] };
      }

      const [bases, neighborRows, settings] = await Promise.all([
        db
          .select()
          .from(staffTravelSettings)
          .where(inArray(staffTravelSettings.staffId, p.staffIds)),
        db
          .select({
            staffId: appointments.staffId,
            during: appointments.during,
            lat: clientAddresses.lat,
            lng: clientAddresses.lng,
          })
          .from(appointments)
          .innerJoin(clientAddresses, eq(clientAddresses.id, appointments.serviceAddressId))
          .where(
            and(
              inArray(appointments.staffId, p.staffIds),
              ne(appointments.status, "cancelled"),
              sql`${appointments.during} && ${range}`,
              isNotNull(clientAddresses.lat),
              isNotNull(clientAddresses.lng),
              p.excludeAppointmentIds?.length
                ? notInArray(appointments.id, p.excludeAppointmentIds)
                : undefined,
            ),
          ),
        db
          .select({ arrivalWindowMin: businessSettings.arrivalWindowMin })
          .from(businessSettings)
          .limit(1),
      ]);

      const travel: Travel = {
        jobPoint: { lat: job.lat, lng: job.lng },
        staffBase: {},
        neighbors: neighborRows.map((r) => ({
          staffId: r.staffId,
          point: { lat: r.lat as number, lng: r.lng as number },
          interval: { start: r.during.start, end: r.during.end },
        })),
        arrivalWindowMinutes: settings[0]?.arrivalWindowMin ?? 120,
      };
      for (const b of bases) {
        travel.staffBase[b.staffId] = {
          lat: b.baseLat,
          lng: b.baseLng,
          speedKmh: b.speedKmh,
          maxTravelMinutes: b.maxTravelMin,
          bufferMinutes: b.travelBufferMin,
        };
      }
      return travel;
    },
  );
}
