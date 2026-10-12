import { NextResponse } from "next/server";
import { withTenantDb } from "@/lib/db/tenant";
import { listActiveTenants } from "@/lib/tenant/registry";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Cron-triggered retry route for failed calendar pushes.
 * Iterates all active tenants and retries appointments with calendarSyncStatus = "failed".
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Server misconfiguration: CRON_SECRET not set" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listActiveTenants();
  let totalRetried = 0;
  let totalFailed = 0;

  for (const tenant of tenants) {
    try {
      const failedAppointments = await withTenantDb(
        tenant.slug,
        async (db, { appointments }) => {
          return db
            .select({ id: appointments.id })
            .from(appointments)
            .where(eq(appointments.calendarSyncStatus, "failed"))
            .limit(50);
        },
      );

      if (failedAppointments.length === 0) continue;

      const { pushBookingToCalendarForTenant } = await import(
        "@/lib/calendar/sync-tenant"
      );

      for (const appt of failedAppointments) {
        try {
          await pushBookingToCalendarForTenant(tenant.slug, appt.id);
          totalRetried++;
        } catch (error) {
          console.error(
            `Retry push failed for appointment ${appt.id} (tenant ${tenant.slug}):`,
            error,
          );
          totalFailed++;
        }
      }
    } catch (error) {
      console.error(
        `Retry push failed for tenant ${tenant.slug}:`,
        error,
      );
      totalFailed++;
    }
  }

  return NextResponse.json({
    retried: totalRetried,
    failed: totalFailed,
    tenants: tenants.length,
  });
}
