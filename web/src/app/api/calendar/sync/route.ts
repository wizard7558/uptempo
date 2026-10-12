import { NextResponse } from "next/server";
import { withTenantDb } from "@/lib/db/tenant";
import { listActiveTenants } from "@/lib/tenant/registry";
import { getCalendarProvider, getValidAccessToken } from "@/lib/calendar/provider";
import { eq, and, gte, lte } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/calendar/sync -- push a specific appointment to external calendar.
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET not set" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    const { auth } = await import("@/lib/auth/server");
    const { headers: getHeaders } = await import("next/headers");
    const session = await auth.api.getSession({
      headers: await getHeaders(),
    });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await req.json();
  if (body.appointmentId && body.tenantSlug) {
    try {
      const { pushBookingToCalendarForTenant } = await import(
        "@/lib/calendar/sync-tenant"
      );
      await pushBookingToCalendarForTenant(body.tenantSlug, body.appointmentId);
      return NextResponse.json({ pushed: body.appointmentId });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 },
      );
    }
  }
  return NextResponse.json(
    { error: "Missing appointmentId or tenantSlug" },
    { status: 400 },
  );
}

/**
 * GET /api/calendar/sync -- triggers external event sync for all active connections across all tenants.
 * Requires CRON_SECRET authorization header.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET not set" },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listActiveTenants();
  const results: Array<{
    tenant: string;
    connectionId: string;
    platform: string;
    eventsSynced?: number;
    error?: string;
  }> = [];

  for (const tenant of tenants) {
    try {
      const connections = await withTenantDb(
        tenant.slug,
        async (db, { calendarConnections }) => {
          return db
            .select()
            .from(calendarConnections)
            .where(eq(calendarConnections.status, "active"));
        },
      );

      for (const connection of connections) {
        try {
          // Refresh tokens for every active connection (including no calendar selected yet).
          const accessToken = await getValidAccessToken(
            connection,
            tenant.slug,
          );

          if (!connection.calendarId) {
            results.push({
              tenant: tenant.slug,
              connectionId: connection.id,
              platform: connection.platform,
              eventsSynced: 0,
            });
            continue;
          }

          const provider = getCalendarProvider(
            connection.platform,
          );
          const calendarId = connection.calendarId;

          const from = new Date();
          from.setHours(0, 0, 0, 0);
          const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

          const busySlots = await provider.getFreeBusy(
            accessToken,
            calendarId,
            from,
            to,
          );

          await withTenantDb(
            tenant.slug,
            async (
              db,
              { externalEvents, calendarConnections: calConns },
            ) => {
              await db.transaction(async (tx) => {
                await tx
                  .delete(externalEvents)
                  .where(
                    and(
                      eq(externalEvents.connectionId, connection.id),
                      gte(externalEvents.startTime, from),
                      lte(externalEvents.endTime, to),
                    ),
                  );

                if (busySlots.length > 0) {
                  await tx.insert(externalEvents).values(
                    busySlots.map((slot) => ({
                      connectionId: connection.id,
                      staffId: connection.staffId,
                      calendarId,
                      startTime: slot.start,
                      endTime: slot.end,
                      isAllDay:
                        slot.start.getUTCHours() === 0 &&
                        slot.start.getUTCMinutes() === 0 &&
                        slot.end.getUTCHours() === 0 &&
                        slot.end.getUTCMinutes() === 0
                          ? 1
                          : 0,
                      freeBusyStatus: "busy" as const,
                      lastSyncedAt: new Date(),
                    })),
                  );
                }
              });

              await db
                .update(calConns)
                .set({
                  lastSyncedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(calConns.id, connection.id));
            },
          );

          results.push({
            tenant: tenant.slug,
            connectionId: connection.id,
            platform: connection.platform,
            eventsSynced: busySlots.length,
          });
        } catch (error) {
          results.push({
            tenant: tenant.slug,
            connectionId: connection.id,
            platform: connection.platform,
            error:
              error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    } catch (error) {
      results.push({
        tenant: tenant.slug,
        connectionId: "N/A",
        platform: "N/A",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ synced: results });
}
