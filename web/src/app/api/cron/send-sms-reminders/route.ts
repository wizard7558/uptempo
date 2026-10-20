import { NextResponse } from "next/server";
import { withTenantDb } from "@/lib/db/tenant";
import { listActiveTenants } from "@/lib/tenant/registry";
import { eq, and, sql, isNull } from "drizzle-orm";
import { sendSms } from "@/lib/sms/send";
import { checkSmsConsent } from "@/lib/sms/consent";
import { isWithinSendWindow } from "@/lib/sms/quiet-hours";
import { createActionToken } from "@/lib/email/tokens";
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { getServicesForAppointment } from "@/lib/queries/appointment-services";
import { getBaseUrl } from "@/lib/utils";
import { renderSmsTemplate } from "@/lib/sms/template";

export const dynamic = "force-dynamic";

/** Opt-out notice appended on its own line after every reminder body. */
const OPT_OUT_FOOTER = "Reply STOP to opt out";

/**
 * How close (in hours) to the exact window mark a "banded" reminder is allowed to
 * fire. The longer reminder only fires as an appointment crosses its window from
 * above — so an appointment already inside the window when booked/enabled gets only
 * the shorter catch-all reminder. The width gives the hourly cron slack to survive a
 * missed run without re-sending (re-sends are also blocked by the sent-at column).
 */
const REMINDER_BAND_HOURS = 2;

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
  const tenantResults: Array<{
    slug: string;
    sent: number;
    failed: number;
    skipped: number;
    error?: string;
  }> = [];

  for (const tenant of tenants) {
    try {
      const result = await sendSmsRemindersForTenant(tenant.slug);
      totalSent += result.sent;
      totalFailed += result.failed;
      totalSkipped += result.skipped;
      tenantResults.push({ slug: tenant.slug, ...result });
    } catch (error) {
      console.error(
        `[SMS Cron] Failed to process SMS reminders for tenant ${tenant.slug}:`,
        error,
      );
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

type ReminderSettings = {
  smsReminderBody: string | null;
  timezone: string | null;
};

/**
 * Send one reminder window for a tenant.
 *
 * - `banded = false` (catch-all): matches any confirmed appointment between now and
 *   `windowHours` ahead that hasn't been sent this slot yet. Used for the shortest
 *   configured window so last-minute bookings always receive a reminder.
 * - `banded = true`: matches only appointments within `REMINDER_BAND_HOURS` of the
 *   exact window mark, i.e. those crossing the window from above. Appointments already
 *   inside the window (booked or enabled late) are skipped and get only the catch-all.
 *
 * `slot` selects which sent-at column tracks this window (1 → smsReminderSentAt,
 * 2 → smsReminderSentAt2) so the two windows never collide.
 */
async function sendReminderWindow(
  tenantSlug: string,
  settings: ReminderSettings,
  baseUrl: string,
  windowHours: number,
  banded: boolean,
  slot: 1 | 2,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const tz = settings.timezone ?? "America/New_York";

  const appts = await withTenantDb(
    tenantSlug,
    async (db, { appointments, clients, staff }) => {
      const lowerBound = banded
        ? sql`lower(${appointments.during}) > now() + interval '${sql.raw(String(windowHours - REMINDER_BAND_HOURS))} hours'`
        : sql`lower(${appointments.during}) > now()`;
      return db
        .select({
          id: appointments.id,
          during: appointments.during,
          clientId: appointments.clientId,
          staffId: appointments.staffId,
          clientName: clients.name,
          clientPhone: clients.phone,
          staffName: staff.displayName,
        })
        .from(appointments)
        .innerJoin(clients, eq(appointments.clientId, clients.id))
        .innerJoin(staff, eq(appointments.staffId, staff.id))
        .where(
          and(
            eq(appointments.status, "confirmed"),
            slot === 1
              ? isNull(appointments.smsReminderSentAt)
              : isNull(appointments.smsReminderSentAt2),
            lowerBound,
            sql`lower(${appointments.during}) <= now() + interval '${sql.raw(String(windowHours))} hours'`,
          ),
        );
    },
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const appt of appts) {
    if (!appt.clientPhone) {
      skipped++;
      continue;
    }

    // Check consent before sending
    const hasConsent = await checkSmsConsent(tenantSlug, appt.clientPhone);
    if (!hasConsent) {
      skipped++;
      continue;
    }

    try {
      // Fetch services for this appointment
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

      // Generate action tokens for cancel/reschedule links
      const rescheduleToken = createActionToken(appt.id, "reschedule");
      const rescheduleUrl = `${baseUrl}/reschedule/${rescheduleToken}`;

      // Format date/time in business timezone
      const apptDate = new TZDate(appt.during.start, tz);
      const dateStr = format(apptDate, "EEEE, MMMM d");
      const timeStr = format(apptDate, "h:mm a");

      // Build SMS body
      let smsBody: string;
      if (settings.smsReminderBody) {
        smsBody = renderSmsTemplate(settings.smsReminderBody, {
          client: appt.clientName ?? "",
          staff: appt.staffName,
          date: dateStr,
          time: timeStr,
          services: serviceNames.join(", "),
        });
      } else {
        smsBody = `Reminder: ${serviceNames.join(", ")} with ${appt.staffName} on ${dateStr} at ${timeStr}. To cancel/reschedule: ${rescheduleUrl}`;
      }

      // Opt-out notice on its own line after the message body.
      smsBody = `${smsBody}\n\n${OPT_OUT_FOOTER}`;

      const result = await sendSms({
        to: appt.clientPhone,
        body: smsBody,
        tenantSlug,
        clientId: appt.clientId,
        appointmentId: appt.id,
        messageType: "reminder",
      });

      if (result.success) {
        // Atomically set the sent-at column to prevent duplicates
        await withTenantDb(tenantSlug, async (db, { appointments }) => {
          await db
            .update(appointments)
            .set(
              slot === 1
                ? { smsReminderSentAt: new Date() }
                : { smsReminderSentAt2: new Date() },
            )
            .where(
              and(
                eq(appointments.id, appt.id),
                slot === 1
                  ? isNull(appointments.smsReminderSentAt)
                  : isNull(appointments.smsReminderSentAt2),
              ),
            );
        });
        sent++;
      } else {
        // sendSms already handles the quiet_hours and no_consent cases
        // but those shouldn't reach here since we pre-check above
        failed++;
      }
    } catch (err) {
      console.error(
        `[SMS Cron] Failed to send reminder (window=${windowHours}h) for appointment:`,
        appt.id,
        err,
      );
      failed++;
    }
  }

  return { sent, failed, skipped };
}

async function sendSmsRemindersForTenant(
  tenantSlug: string,
): Promise<{ sent: number; failed: number; skipped: number }> {
  // Get SMS settings from business_settings
  const settings = await withTenantDb(
    tenantSlug,
    async (db, { businessSettings }) => {
      const [policy] = await db
        .select({
          smsRemindersEnabled: businessSettings.smsRemindersEnabled,
          smsReminderHoursBefore: businessSettings.smsReminderHoursBefore,
          smsReminderHoursBefore2: businessSettings.smsReminderHoursBefore2,
          smsReminderBody: businessSettings.smsReminderBody,
          timezone: businessSettings.timezone,
        })
        .from(businessSettings)
        .limit(1);
      return policy;
    },
  );

  if (!settings?.smsRemindersEnabled) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const tz = settings.timezone ?? "America/New_York";

  // Check quiet hours at the tenant level — skip all if outside window
  if (!isWithinSendWindow(tz)) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const baseUrl = getBaseUrl();
  const w1 = settings.smsReminderHoursBefore;
  const w2 = settings.smsReminderHoursBefore2;

  // The shortest configured window is the catch-all reminder (no lower bound) so
  // last-minute bookings still receive it. Any longer window is "banded" — it only
  // fires as the appointment crosses that window. Example with 24h + 72h: an
  // appointment 48h out gets only the 24h text; an appointment booked 5 days out
  // gets the 72h text first, then the 24h text as it gets closer.
  const totals = { sent: 0, failed: 0, skipped: 0 };

  const r1 = await sendReminderWindow(
    tenantSlug,
    settings,
    baseUrl,
    w1,
    w2 != null && w1 > w2,
    1,
  );
  totals.sent += r1.sent;
  totals.failed += r1.failed;
  totals.skipped += r1.skipped;

  if (w2 != null) {
    const r2 = await sendReminderWindow(
      tenantSlug,
      settings,
      baseUrl,
      w2,
      w2 > w1,
      2,
    );
    totals.sent += r2.sent;
    totals.failed += r2.failed;
    totals.skipped += r2.skipped;
  }

  return totals;
}
