import { getEmailT } from "@/lib/terms/email";
import { eq, and } from "drizzle-orm";
import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { memberships } from "@/lib/db/schema/memberships";
import { withTenantDb } from "@/lib/db/tenant";
import { sendEmail } from "@/lib/email/send";
import { getEmailBranding } from "@/lib/email/branding";
import { getBaseUrl } from "@/lib/utils";
import { CalendarDisconnectEmail } from "@/emails/calendar-disconnect";

function platformLabel(platform: string): string {
  if (platform === "google_calendar") return "Google Calendar";
  return platform;
}

/**
 * Notify salon owner by email when a calendar connection breaks (active → error).
 * No-op if no owner email is found.
 */
export async function notifyCalendarConnectionError(params: {
  tenantSlug: string;
  staffId: string;
  platform: string;
}): Promise<void> {
  const { tenantSlug, staffId, platform } = params;

  const [owner] = await publicDb
    .select({ email: user.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(
      and(eq(memberships.tenantSlug, tenantSlug), eq(memberships.role, "owner")),
    )
    .limit(1);

  if (!owner?.email) {
    console.warn(
      `[calendar] No owner email for tenant ${tenantSlug}; skipping disconnect notification`,
    );
    return;
  }

  const staffName = await withTenantDb(
    tenantSlug,
    async (db, { staff }) => {
      const [row] = await db
        .select({ displayName: staff.displayName })
        .from(staff)
        .where(eq(staff.id, staffId))
        .limit(1);
      return row?.displayName ?? "A team member";
    },
  );

  const settingsUrl = `${getBaseUrl()}/settings/calendars`;
  const [emailT, branding] = await Promise.all([
    getEmailT(tenantSlug, "emails"),
    getEmailBranding(tenantSlug),
  ]);
  const platformName = platformLabel(platform);

  await sendEmail({
    to: owner.email,
    subject: emailT("calendar.subject", { platform: platformName }),
    salonName: branding.salonName,
    react: (
      <CalendarDisconnectEmail
        t={emailT}
        salonName={branding.salonName}
        staffName={staffName}
        platformLabel={platformName}
        settingsUrl={settingsUrl}
        logoUrl={branding.logoUrl}
        brandColor={branding.brandColor}
      />
    ),
  });
}
