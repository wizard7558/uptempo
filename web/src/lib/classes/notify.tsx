import { eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { sendSms } from "@/lib/sms/send";
import { sendEmail } from "@/lib/email/send";
import { getEmailT } from "@/lib/terms/email";
import { getEmailBranding } from "@/lib/email/branding";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { toPlainAscii } from "@/lib/sms/plain-text";
import { getBaseUrl } from "@/lib/utils";
import { RequestNewEmail } from "@/emails/request-new";

/** "Mon, Jun 15" and "6:00 AM" for an instant, as seen in the business's timezone. */
export function formatClassWhen(start: Date, timezone: string): { date: string; time: string } {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(start);
  return { date, time: time.replace(/\s/g, " ") };
}

async function loadSessionFacts(slug: string, sessionId: string) {
  const [row] = await withTenantDb(slug, async (db, t) =>
    db
      .select({ during: t.classSessions.during, className: t.services.name })
      .from(t.classSessions)
      .innerJoin(t.services, eq(t.services.id, t.classSessions.serviceId))
      .where(eq(t.classSessions.id, sessionId))
      .limit(1),
  );
  if (!row) return null;
  const [settings, tenant, et] = await Promise.all([
    loadSchedulingSettings(slug),
    getTenantBySlug(slug),
    getEmailT(slug, "emails"),
  ]);
  return {
    et,
    business: tenant?.name ?? et("fallbacks.ourPlaceTitle"),
    className: row.className,
    ...formatClassWhen(row.during.start, settings.timezone),
  };
}

/** Logs a failed or skipped text. Notifications never throw into the booking flow. */
async function textClient(p: {
  slug: string;
  clientId: string;
  phone: string | null;
  body: string;
  messageType: string;
}): Promise<void> {
  if (!p.phone) return;
  try {
    const sent = await sendSms({
      to: p.phone,
      body: p.body,
      tenantSlug: p.slug,
      clientId: p.clientId,
      messageType: p.messageType,
    });
    if (!sent.success) console.warn(`[classes] ${p.messageType} text not sent: ${sent.error ?? "unknown"}`);
  } catch (err) {
    console.error(`[classes] ${p.messageType} text failed`, err);
  }
}

/** Tells a waitlisted client their spot opened: a text, plus an email when they have one. Call after commit. */
export async function notifyPromoted(slug: string, enrollmentId: string): Promise<void> {
  try {
    const [row] = await withTenantDb(slug, async (db, t) =>
      db
        .select({
          sessionId: t.classEnrollments.sessionId,
          clientId: t.clients.id,
          phone: t.clients.phone,
          email: t.clients.email,
        })
        .from(t.classEnrollments)
        .innerJoin(t.clients, eq(t.clients.id, t.classEnrollments.clientId))
        .where(eq(t.classEnrollments.id, enrollmentId))
        .limit(1),
    );
    if (!row) return;
    const facts = await loadSessionFacts(slug, row.sessionId);
    if (!facts) return;
    const link = `${getBaseUrl()}/book/${slug}/classes`;
    const values = {
      business: facts.business,
      className: facts.className,
      date: facts.date,
      time: facts.time,
      link,
    };
    await textClient({
      slug,
      clientId: row.clientId,
      phone: row.phone,
      body: toPlainAscii(facts.et("classes.promotedSms", values)),
      messageType: "waitlist_promoted",
    });
    if (row.email) {
      const branding = await getEmailBranding(slug);
      const subject = facts.et("classes.promotedSubject", { className: facts.className });
      const result = await sendEmail({
        to: row.email,
        subject,
        salonName: branding.salonName,
        react: (
          <RequestNewEmail
            t={facts.et}
            salonName={branding.salonName}
            heading={subject}
            body={facts.et("classes.promotedBody", {
              className: facts.className,
              date: facts.date,
              time: facts.time,
            })}
            cta={facts.et("classes.promotedCta")}
            url={link}
            logoUrl={branding.logoUrl}
            brandColor={branding.brandColor}
          />
        ),
      });
      if (!result.success) console.warn("[classes] promotion email not sent");
    }
  } catch (err) {
    console.error("[classes] promotion notice failed", err);
  }
}

export type CancelRecipient = { clientId: string; phone: string | null };

/** Texts everyone who held a spot in a class that was cancelled. Call after commit. */
export async function notifyClassCancelled(
  slug: string,
  sessionId: string,
  recipients: CancelRecipient[],
): Promise<void> {
  try {
    if (recipients.length === 0) return;
    const facts = await loadSessionFacts(slug, sessionId);
    if (!facts) return;
    const body = toPlainAscii(
      facts.et("classes.cancelledSms", {
        business: facts.business,
        className: facts.className,
        date: facts.date,
        time: facts.time,
      }),
    );
    await Promise.all(
      recipients.map((r) =>
        textClient({ slug, clientId: r.clientId, phone: r.phone, body, messageType: "class_cancelled" }),
      ),
    );
  } catch (err) {
    console.error("[classes] cancellation notice failed", err);
  }
}
