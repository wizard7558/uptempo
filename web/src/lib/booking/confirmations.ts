/**
 * Booking confirmations: the owner push, the client email and text, and the
 * consent-form requests for the booked services. Best effort and never throws:
 * a booking that succeeded must not fail because a message did not go out.
 * Shared by the public booking confirm step and the accepted-quote flow.
 */
import { format } from "date-fns";
import { TZDate } from "@date-fns/tz";
import { eq, and } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getT } from "@/lib/terms/server";
import { getEmailT } from "@/lib/terms/email";
import {
  DEFAULT_SMS_CONFIRMATION_TEMPLATE,
  renderSmsTemplate,
} from "@/lib/sms/template";
import { tenantPublicBaseUrl } from "@/lib/booking/public-url";
import { formatLocationFromObject } from "@/lib/booking/format-location-label";
import { sendEmail } from "@/lib/email/send";
import { createActionToken } from "@/lib/email/tokens";
import { getNotificationSettingsForTenant } from "@/lib/notifications/settings";
import { loadAppointmentForTenant } from "@/lib/appointments/load";
import { loadFormsForServices } from "@/lib/forms/for-services";
import { BookingConfirmation } from "@/emails/booking-confirmation";

export async function sendBookingConfirmations(
  slug: string,
  appointmentId: string,
): Promise<void> {
  try {
    const appointment = await loadAppointmentForTenant(slug, appointmentId);
    if (!appointment) return;
    const staffId = appointment.staffId;
    const totalDuration = appointment.services.reduce(
      (sum, s) => sum + s.durationMinutes,
      0,
    );
    const staffDisplayName = await withTenantDb(slug, async (db, { staff }) => {
      const [staffMember] = await db
        .select({ displayName: staff.displayName })
        .from(staff)
        .where(eq(staff.id, staffId))
        .limit(1);
      return staffMember?.displayName ?? null;
    });
    const staffName =
      staffDisplayName ??
      (await getT("booking", slug))("bookingWizard.staffFallback");
    const serviceNames = appointment.services.map((s) => s.serviceName);
    try {
      const tz = await withTenantDb(slug, async (db, { businessSettings }) => {
        const [policy] = await db
          .select({ timezone: businessSettings.timezone })
          .from(businessSettings)
          .limit(1);
        return policy?.timezone ?? "America/New_York";
      });

      // Native push to the business's registered owner-app devices (own catch so
      // a push failure never blocks the client confirmations below).
      try {
        const { sendApnsNotifications, bundleIdForOwnerType } =
          await import("@/lib/push/apns");
        const ownerTokens = await withTenantDb(
          slug,
          async (db, { deviceTokens }) =>
            db
              .select({
                apnsToken: deviceTokens.apnsToken,
                environment: deviceTokens.environment,
              })
              .from(deviceTokens)
              .where(
                and(
                  eq(deviceTokens.ownerType, "user"),
                  eq(deviceTokens.revoked, 0),
                ),
              ),
        );
        if (ownerTokens.length > 0) {
          const when = format(
            new TZDate(appointment.start, tz),
            "EEE MMM d 'at' h:mm a",
          );
          const results = await sendApnsNotifications(
            ownerTokens.map((t) => ({
              apnsToken: t.apnsToken,
              environment: t.environment as "sandbox" | "production",
            })),
            {
              title: "New booking",
              body: `${appointment.client?.name ?? "A client"} booked ${
                serviceNames.join(", ") || "an appointment"
              } with ${staffName} — ${when}.`,
              data: { path: "/schedule" },
            },
            bundleIdForOwnerType("user") ?? "",
          );
          const dead = results
            .filter((r) => r.shouldRevoke)
            .map((r) => r.apnsToken);
          if (dead.length > 0) {
            await withTenantDb(slug, async (db, { deviceTokens }) => {
              for (const token of dead) {
                await db
                  .update(deviceTokens)
                  .set({ revoked: 1 })
                  .where(eq(deviceTokens.apnsToken, token));
              }
            });
          }
        }
      } catch (pushErr) {
        console.error(
          "Owner new-booking push failed for appointment:",
          appointmentId,
          pushErr,
        );
      }

      const settings = await getNotificationSettingsForTenant(slug);
      if (!settings.confirmationEnabled) return;

      const clientEmail = appointment.client?.email;
      if (!clientEmail) return;

      const { getEmailBranding } = await import("@/lib/email/branding");
      const [emailBranding, emailT] = await Promise.all([
        getEmailBranding(slug),
        getEmailT(slug, "emails"),
      ]);
      const businessName = emailBranding.businessName;

      // Generate action tokens
      const cancelToken = createActionToken(appointment.id, "cancel");
      const rescheduleToken = createActionToken(appointment.id, "reschedule");
      const baseUrl = tenantPublicBaseUrl(slug);
      const cancelUrl = `${baseUrl}/cancel/${cancelToken}`;
      const rescheduleUrl = `${baseUrl}/reschedule/${rescheduleToken}`;

      // Format date/time in business timezone
      const apptDate = new TZDate(appointment.start, tz);
      const dateStr = format(apptDate, "EEEE, MMMM d, yyyy");
      const timeStr = format(apptDate, "h:mm a");
      const durationStr = `${totalDuration} minutes`;

      await sendEmail({
        to: clientEmail,
        subject: emailT("confirmation.subject", { business: businessName }),
        react: BookingConfirmation({
          t: emailT,
          businessName,
          clientName: appointment.client?.name ?? "there",
          staffName,
          services: serviceNames,
          date: dateStr,
          time: timeStr,
          duration: durationStr,
          businessAddress: formatLocationFromObject(
            appointment.location,
            settings.businessAddress,
          ),
          cancelUrl,
          rescheduleUrl,
          customGreeting: settings.confirmationGreeting,
          customBody: settings.confirmationBody,
          logoUrl: emailBranding.logoUrl,
          brandColor: emailBranding.brandColor,
        }),
        businessName,
      });

      if (settings.smsConfirmationEnabled === 1 && appointment.client?.phone) {
        const { sendSms } = await import("@/lib/sms/send");
        const servicesStr = serviceNames.join(", ");
        const tmpl =
          settings.smsConfirmationBody?.trim() ||
          DEFAULT_SMS_CONFIRMATION_TEMPLATE;
        const body = renderSmsTemplate(tmpl, {
          client: appointment.client?.name ?? "there",
          staff: staffName,
          date: dateStr,
          time: timeStr,
          services: servicesStr,
        });
        await sendSms({
          to: appointment.client.phone,
          body,
          tenantSlug: slug,
          clientId: appointment.client.id,
          appointmentId: appointment.id,
          messageType: "confirmation",
        });
      }

      // Send form request emails for services with assigned forms
      try {
        const formsToSend = await loadFormsForServices(
          slug,
          appointment.services.map((s) => s.serviceId),
        );
        if (formsToSend.length > 0 && clientEmail) {
          const { createFormToken } = await import("@/lib/email/tokens");
          const { FormRequestEmail } = await import("@/emails/form-request");
          for (const form of formsToSend) {
            // Create stub form_responses record
            const [responseRecord] = await withTenantDb(
              slug,
              async (db, { formResponses }) => {
                return db
                  .insert(formResponses)
                  .values({
                    formTemplateId: form.id,
                    appointmentId: appointmentId,
                    clientId: appointment.client.id,
                    responses: {},
                  })
                  .returning({ id: formResponses.id });
              },
            );
            // Generate signed token and send email
            const formToken = createFormToken(responseRecord.id, appointmentId);
            const formUrl = `${baseUrl}/forms/${formToken}`;
            await sendEmail({
              to: clientEmail,
              subject: emailT("form.subject", { form: form.name }),
              react: FormRequestEmail({
                t: emailT,
                businessName,
                clientName: appointment.client?.name ?? "there",
                formName: form.name,
                formDescription: form.description,
                formUrl,
                logoUrl: emailBranding.logoUrl,
                brandColor: emailBranding.brandColor,
              }),
              businessName,
            });

            if (
              settings.smsFormRequestsEnabled === 1 &&
              appointment.client?.phone
            ) {
              const { sendSms } = await import("@/lib/sms/send");
              await sendSms({
                to: appointment.client.phone,
                body: `${businessName}: please complete "${form.name}": ${formUrl}`,
                tenantSlug: slug,
                clientId: appointment.client.id,
                appointmentId: appointmentId,
                messageType: "form_request",
              });
            }
          }
        }
      } catch (formErr) {
        console.error(
          "Form email failed for appointment:",
          appointmentId,
          formErr,
        );
      }
    } catch (err) {
      console.error(
        "Confirmation email failed for appointment:",
        appointmentId,
        err,
      );
    }
  } catch (err) {
    console.error("Confirmations failed for appointment:", appointmentId, err);
  }
}
