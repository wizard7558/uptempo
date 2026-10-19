import { getEmailT } from "@/lib/terms/email";
import { getEmailBranding } from "@/lib/email/branding";
import { NextResponse } from "next/server";
import { withTenantDb } from "@/lib/db/tenant";
import { listActiveTenants } from "@/lib/tenant/registry";
import { eq, and, sql, isNull } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { createActionToken } from "@/lib/email/tokens";
import { BookingReminder } from "@/emails/booking-reminder";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { getServicesForAppointment } from "@/lib/queries/appointment-services";
import { getBaseUrl } from "@/lib/utils";
import { formatLocationLines } from "@/lib/booking/format-location-label";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify CRON_SECRET (mandatory)
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
  const tenantResults: Array<{ slug: string; sent: number; failed: number; skipped: number; error?: string }> = [];

  for (const tenant of tenants) {
    try {
      const result = await sendRemindersForTenant(tenant.slug);
      totalSent += result.sent;
      totalFailed += result.failed;
      totalSkipped += result.skipped;
      tenantResults.push({ slug: tenant.slug, ...result });
    } catch (error) {
      console.error(`[Cron] Failed to process reminders for tenant ${tenant.slug}:`, error);
      totalFailed++;
      tenantResults.push({
        slug: tenant.slug,
        sent: 0,
        failed: 1,
        skipped: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    sent: totalSent,
    failed: totalFailed,
    skipped: totalSkipped,
    tenants: tenantResults.length,
  });
}

async function sendRemindersForTenant(
  tenantSlug: string,
): Promise<{ sent: number; failed: number; skipped: number }> {
  // Get notification settings for this tenant
  const settings = await withTenantDb(tenantSlug, async (db, { businessSettings }) => {
    const [policy] = await db
      .select({
        confirmationEnabled: businessSettings.confirmationEnabled,
        reminderEnabled: businessSettings.reminderEnabled,
        reminderHoursBefore: businessSettings.reminderHoursBefore,
        reminderHoursBefore2: businessSettings.reminderHoursBefore2,
        confirmationGreeting: businessSettings.confirmationGreeting,
        confirmationBody: businessSettings.confirmationBody,
        reminderGreeting: businessSettings.reminderGreeting,
        reminderBody: businessSettings.reminderBody,
        businessAddress: businessSettings.businessAddress,
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
  const baseUrl = getBaseUrl();

  const [emailT, branding] = await Promise.all([
    getEmailT(tenantSlug, "emails"),
    getEmailBranding(tenantSlug),
  ]);
  const businessName = branding.businessName;

  // Query upcoming appointments for this tenant
  const hoursAhead = settings.reminderHoursBefore;

  const upcomingAppointments = await withTenantDb(tenantSlug, async (db, { appointments, clients, staff, locations }) => {
    return db
      .select({
        id: appointments.id,
        during: appointments.during,
        clientId: appointments.clientId,
        staffId: appointments.staffId,
        clientName: clients.name,
        clientEmail: clients.email,
        staffName: staff.displayName,
        locationName: locations.name,
        locationAddress: locations.address,
      })
      .from(appointments)
      .innerJoin(clients, eq(appointments.clientId, clients.id))
      .innerJoin(staff, eq(appointments.staffId, staff.id))
      .leftJoin(locations, eq(appointments.locationId, locations.id))
      .where(
        and(
          eq(appointments.status, "confirmed"),
          isNull(appointments.reminderSentAt),
          sql`lower(${appointments.during}) > now()`,
          sql`lower(${appointments.during}) <= now() + interval '${sql.raw(String(hoursAhead))} hours'`,
        ),
      );
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const appt of upcomingAppointments) {
    if (!appt.clientEmail) {
      skipped++;
      continue;
    }

    try {
      // Fetch services for this appointment
      const apptServices = await withTenantDb(tenantSlug, async (db, { appointmentServices, services }) => {
        return getServicesForAppointment(db, { appointmentServices, services }, appt.id);
      });

      const serviceNames = apptServices.map((s) => s.serviceName);

      // Generate action tokens
      const cancelToken = createActionToken(appt.id, "cancel");
      const rescheduleToken = createActionToken(appt.id, "reschedule");
      const cancelUrl = `${baseUrl}/cancel/${cancelToken}`;
      const rescheduleUrl = `${baseUrl}/reschedule/${rescheduleToken}`;

      // Format date/time in salon timezone
      const apptDate = new TZDate(appt.during.start, tz);
      const dateStr = format(apptDate, "EEEE, MMMM d, yyyy");
      const timeStr = format(apptDate, "h:mm a");
      const durationMs =
        appt.during.end.getTime() - appt.during.start.getTime();
      const durationMin = Math.round(durationMs / 60_000);
      const durationStr = `${durationMin} minutes`;

      const result = await sendEmail({
        to: appt.clientEmail,
        subject: emailT("reminder.subject", { business: businessName }),
        react: BookingReminder({
          businessName,
          clientName: appt.clientName ?? "there",
          staffName: appt.staffName,
          t: emailT,
          logoUrl: branding.logoUrl,
          brandColor: branding.brandColor,
          services: serviceNames,
          date: dateStr,
          time: timeStr,
          duration: durationStr,
          businessAddress: formatLocationLines(
            appt.locationName,
            appt.locationAddress,
            settings.businessAddress,
          ),
          cancelUrl,
          rescheduleUrl,
          customGreeting: settings.reminderGreeting,
          customBody: settings.reminderBody,
        }),
        businessName,
      });

      if (result.success) {
        // Atomically set reminderSentAt to prevent duplicates
        await withTenantDb(tenantSlug, async (db, { appointments }) => {
          await db
            .update(appointments)
            .set({ reminderSentAt: new Date() })
            .where(
              and(
                eq(appointments.id, appt.id),
                isNull(appointments.reminderSentAt),
              ),
            );
        });
        sent++;
      } else {
        // Do not set reminderSentAt so it retries on next cron run
        failed++;
      }
    } catch (err) {
      console.error(
        "[Cron] Failed to send reminder for appointment:",
        appt.id,
        err,
      );
      failed++;
    }
  }

  if (settings.reminderHoursBefore2 != null) {
    const hoursAhead2 = settings.reminderHoursBefore2;
    const upcoming2 = await withTenantDb(
      tenantSlug,
      async (db, { appointments, clients, staff, locations }) => {
        return db
          .select({
            id: appointments.id,
            during: appointments.during,
            clientId: appointments.clientId,
            staffId: appointments.staffId,
            clientName: clients.name,
            clientEmail: clients.email,
            staffName: staff.displayName,
            locationName: locations.name,
            locationAddress: locations.address,
          })
          .from(appointments)
          .innerJoin(clients, eq(appointments.clientId, clients.id))
          .innerJoin(staff, eq(appointments.staffId, staff.id))
          .leftJoin(locations, eq(appointments.locationId, locations.id))
          .where(
            and(
              eq(appointments.status, "confirmed"),
              isNull(appointments.reminderSentAt2),
              sql`lower(${appointments.during}) > now()`,
              sql`lower(${appointments.during}) <= now() + interval '${sql.raw(String(hoursAhead2))} hours'`,
            ),
          );
      },
    );

    for (const appt of upcoming2) {
      if (!appt.clientEmail) {
        skipped++;
        continue;
      }

      try {
        const apptServices = await withTenantDb(
          tenantSlug,
          async (db, { appointmentServices, services }) => {
            return getServicesForAppointment(
              db,
              { appointmentServices, services },
              appt.id,
            );
          },
        );

        const serviceNames = apptServices.map((s) => s.serviceName);

        const cancelToken = createActionToken(appt.id, "cancel");
        const rescheduleToken = createActionToken(appt.id, "reschedule");
        const cancelUrl = `${baseUrl}/cancel/${cancelToken}`;
        const rescheduleUrl = `${baseUrl}/reschedule/${rescheduleToken}`;

        const apptDate = new TZDate(appt.during.start, tz);
        const dateStr = format(apptDate, "EEEE, MMMM d, yyyy");
        const timeStr = format(apptDate, "h:mm a");
        const durationMs =
          appt.during.end.getTime() - appt.during.start.getTime();
        const durationMin = Math.round(durationMs / 60_000);
        const durationStr = `${durationMin} minutes`;

        const result = await sendEmail({
          to: appt.clientEmail,
          subject: emailT("reminder.subject", { business: businessName }),
          react: BookingReminder({
            businessName,
            clientName: appt.clientName ?? "there",
            staffName: appt.staffName,
            t: emailT,
            logoUrl: branding.logoUrl,
            brandColor: branding.brandColor,
            services: serviceNames,
            date: dateStr,
            time: timeStr,
            duration: durationStr,
            businessAddress: formatLocationLines(
              appt.locationName,
              appt.locationAddress,
              settings.businessAddress,
            ),
            cancelUrl,
            rescheduleUrl,
            customGreeting: settings.reminderGreeting,
            customBody: settings.reminderBody,
          }),
          businessName,
        });

        if (result.success) {
          await withTenantDb(tenantSlug, async (db, { appointments }) => {
            await db
              .update(appointments)
              .set({ reminderSentAt2: new Date() })
              .where(
                and(
                  eq(appointments.id, appt.id),
                  isNull(appointments.reminderSentAt2),
                ),
              );
          });
          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(
          "[Cron] Failed to send second reminder for appointment:",
          appt.id,
          err,
        );
        failed++;
      }
    }
  }

  return { sent, failed, skipped };
}
