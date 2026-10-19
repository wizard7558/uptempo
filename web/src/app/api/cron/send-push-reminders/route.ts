import { getEmailT } from "@/lib/terms/email";
import { NextResponse } from "next/server";
import { withTenantDb } from "@/lib/db/tenant";
import { listActiveTenants, getTenantBySlug } from "@/lib/tenant/registry";
import { eq, and, sql, isNull } from "drizzle-orm";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { getServicesForAppointment } from "@/lib/queries/appointment-services";
import { isWithinSendWindow } from "@/lib/sms/quiet-hours";
import {
  sendApnsNotifications,
  bundleIdForOwnerType,
  type ApnsEnvironment,
} from "@/lib/push/apns";

export const dynamic = "force-dynamic";

/**
 * Sends native push (APNs) appointment reminders to booking clients who have
 * registered an iOS device. Mirrors send-reminders / send-sms-reminders:
 * CRON_SECRET-guarded, per-tenant, deduped via a per-appointment sent-at
 * column. Push targets the client app topic; owner alerts are a separate
 * (future) path.
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
  let totalSent = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const tenant of tenants) {
    try {
      const result = await sendPushForTenant(tenant.slug);
      totalSent += result.sent;
      totalFailed += result.failed;
      totalSkipped += result.skipped;
    } catch (error) {
      console.error(
        `[Cron] Failed to process push reminders for tenant ${tenant.slug}:`,
        error,
      );
      totalFailed++;
    }
  }

  return NextResponse.json({
    sent: totalSent,
    failed: totalFailed,
    skipped: totalSkipped,
    tenants: tenants.length,
  });
}

async function sendPushForTenant(
  tenantSlug: string,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const settings = await withTenantDb(tenantSlug, async (db, { businessSettings }) => {
    const [policy] = await db
      .select({
        reminderEnabled: businessSettings.reminderEnabled,
        reminderHoursBefore: businessSettings.reminderHoursBefore,
        reminderHoursBefore2: businessSettings.reminderHoursBefore2,
        timezone: businessSettings.timezone,
      })
      .from(businessSettings)
      .limit(1);
    return policy;
  });

  if (!settings?.reminderEnabled) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const tz = settings.timezone ?? "America/New_York";
  // Respect business quiet hours (same window as SMS) — push is opt-in but still
  // shouldn't fire overnight.
  if (!isWithinSendWindow(tz)) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const tenant = await getTenantBySlug(tenantSlug);
  const businessName = tenant?.name ?? (await getEmailT(tenantSlug, "emails"))("fallbacks.yourPlace");
  const topic = bundleIdForOwnerType("client") ?? "";

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const waves: Array<"first" | "second"> = ["first"];
  if (settings.reminderHoursBefore2 != null) waves.push("second");

  for (const wave of waves) {
    const hoursAhead =
      wave === "first"
        ? settings.reminderHoursBefore
        : settings.reminderHoursBefore2!;

    const upcoming = await withTenantDb(
      tenantSlug,
      async (db, { appointments, clients, staff }) =>
        db
          .select({
            id: appointments.id,
            during: appointments.during,
            clientId: appointments.clientId,
            clientName: clients.name,
            staffName: staff.displayName,
          })
          .from(appointments)
          .innerJoin(clients, eq(appointments.clientId, clients.id))
          .innerJoin(staff, eq(appointments.staffId, staff.id))
          .where(
            and(
              eq(appointments.status, "confirmed"),
              wave === "first"
                ? isNull(appointments.pushReminderSentAt)
                : isNull(appointments.pushReminderSentAt2),
              sql`lower(${appointments.during}) > now()`,
              sql`lower(${appointments.during}) <= now() + interval '${sql.raw(String(hoursAhead))} hours'`,
            ),
          ),
    );

    for (const appt of upcoming) {
      try {
        // Find this client's live device tokens.
        const tokens = await withTenantDb(
          tenantSlug,
          async (db, { deviceTokens }) =>
            db
              .select({
                apnsToken: deviceTokens.apnsToken,
                environment: deviceTokens.environment,
              })
              .from(deviceTokens)
              .where(
                and(
                  eq(deviceTokens.ownerType, "client"),
                  eq(deviceTokens.ownerId, appt.clientId),
                  eq(deviceTokens.revoked, 0),
                ),
              ),
        );

        if (tokens.length === 0) {
          skipped++;
          continue;
        }

        const apptServices = await withTenantDb(
          tenantSlug,
          async (db, { appointmentServices, services }) =>
            getServicesForAppointment(
              db,
              { appointmentServices, services },
              appt.id,
            ),
        );
        const serviceNames = apptServices.map((s) => s.serviceName);

        const apptDate = new TZDate(appt.during.start, tz);
        const timeStr = format(apptDate, "EEE MMM d 'at' h:mm a");
        const serviceLabel =
          serviceNames.length > 0 ? serviceNames.join(", ") : "your appointment";

        const results = await sendApnsNotifications(
          tokens.map((t) => ({
            apnsToken: t.apnsToken,
            environment: t.environment as ApnsEnvironment,
          })),
          {
            title: businessName,
            body: `Reminder: ${serviceLabel} with ${appt.staffName} ${timeStr}.`,
            data: { path: "/account" },
          },
          topic,
        );

        // Revoke dead tokens Apple rejected.
        const dead = results.filter((r) => r.shouldRevoke).map((r) => r.apnsToken);
        if (dead.length > 0) {
          await withTenantDb(tenantSlug, async (db, { deviceTokens }) => {
            for (const token of dead) {
              await db
                .update(deviceTokens)
                .set({ revoked: 1 })
                .where(eq(deviceTokens.apnsToken, token));
            }
          });
        }

        if (results.some((r) => r.ok)) {
          await withTenantDb(tenantSlug, async (db, { appointments }) => {
            await db
              .update(appointments)
              .set(
                wave === "first"
                  ? { pushReminderSentAt: new Date() }
                  : { pushReminderSentAt2: new Date() },
              )
              .where(
                and(
                  eq(appointments.id, appt.id),
                  wave === "first"
                    ? isNull(appointments.pushReminderSentAt)
                    : isNull(appointments.pushReminderSentAt2),
                ),
              );
          });
          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(
          "[Cron] Failed to send push reminder for appointment:",
          appt.id,
          err,
        );
        failed++;
      }
    }
  }

  return { sent, failed, skipped };
}
