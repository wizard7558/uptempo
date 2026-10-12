import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";
import type { TenantTables } from "@/lib/db/tenant-schema";
import type { ServiceLine, VisitHistoryRow } from "./service-metrics";

const CHUNK = 1000;

/**
 * Loads the non-cancelled service lines that start inside `range`, plus the
 * non-cancelled appointment history for those clients (any date), which the
 * pure metrics need to decide "booked again" and new vs returning.
 */
export async function loadServiceAnalyticsInputs(
  db: TenantDb,
  t: TenantTables,
  range: { start: Date; end: Date },
): Promise<{ lines: ServiceLine[]; history: VisitHistoryRow[] }> {
  const startsAtMs = sql<number>`(extract(epoch from lower(${t.appointments.during})) * 1000)::float8`;

  const lineRows = await db
    .select({
      appointmentId: t.appointments.id,
      clientId: t.appointments.clientId,
      staffId: t.appointments.staffId,
      staffName: t.staff.displayName,
      serviceId: t.appointmentServices.serviceId,
      serviceName: t.services.name,
      status: t.appointments.status,
      startsAtMs,
      clientStatusAtBooking: t.appointments.clientStatusAtBooking,
      lineCents: sql<number>`COALESCE(${t.appointmentServices.priceChargedCents}, ${t.services.priceCents}, 0)::int`,
      lineMinutes: t.appointmentServices.durationMinutes,
    })
    .from(t.appointmentServices)
    .innerJoin(
      t.appointments,
      eq(t.appointmentServices.appointmentId, t.appointments.id),
    )
    .innerJoin(t.services, eq(t.appointmentServices.serviceId, t.services.id))
    .innerJoin(t.staff, eq(t.appointments.staffId, t.staff.id))
    .where(
      and(
        ne(t.appointments.status, "cancelled"),
        sql`lower(${t.appointments.during}) >= ${range.start.toISOString()}::timestamptz`,
        sql`lower(${t.appointments.during}) <= ${range.end.toISOString()}::timestamptz`,
      ),
    );

  const lines: ServiceLine[] = lineRows.map((r) => ({
    appointmentId: r.appointmentId,
    clientId: r.clientId,
    staffId: r.staffId,
    staffName: r.staffName,
    serviceId: r.serviceId,
    serviceName: r.serviceName,
    status: r.status,
    startsAt: new Date(Number(r.startsAtMs)),
    clientStatusAtBooking: r.clientStatusAtBooking,
    lineCents: r.lineCents,
    lineMinutes: r.lineMinutes,
  }));

  const clientIds = [...new Set(lines.map((l) => l.clientId))];
  const history: VisitHistoryRow[] = [];
  for (let i = 0; i < clientIds.length; i += CHUNK) {
    const chunk = clientIds.slice(i, i + CHUNK);
    const rows = await db
      .select({
        appointmentId: t.appointments.id,
        clientId: t.appointments.clientId,
        staffId: t.appointments.staffId,
        startsAtMs,
      })
      .from(t.appointments)
      .where(
        and(
          inArray(t.appointments.clientId, chunk),
          ne(t.appointments.status, "cancelled"),
        ),
      );
    for (const r of rows) {
      history.push({
        appointmentId: r.appointmentId,
        clientId: r.clientId,
        staffId: r.staffId,
        startsAt: new Date(Number(r.startsAtMs)),
      });
    }
  }

  return { lines, history };
}
