import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";

export const ETA_CHOICES = [10, 15, 20, 30, 45, 60] as const;
export const ON_MY_WAY_COOLDOWN_MINUTES = 30;

export type OnMyWayTarget = {
  id: string;
  staffId: string;
  staffName: string;
  status: string;
  start: Date;
  serviceAddressId: string | null;
  onMyWaySentAt: Date | null;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  timezone: string;
};

export async function loadOnMyWayTarget(
  slug: string,
  appointmentId: string,
): Promise<OnMyWayTarget | null> {
  return withTenantDb(slug, async (db, { appointments, clients, staff, businessSettings }) => {
    const [row] = await db
      .select({
        id: appointments.id,
        staffId: appointments.staffId,
        staffName: staff.displayName,
        status: appointments.status,
        during: appointments.during,
        serviceAddressId: appointments.serviceAddressId,
        onMyWaySentAt: appointments.onMyWaySentAt,
        clientId: clients.id,
        clientName: clients.name,
        clientPhone: clients.phone,
      })
      .from(appointments)
      .innerJoin(clients, eq(clients.id, appointments.clientId))
      .innerJoin(staff, eq(staff.id, appointments.staffId))
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    if (!row) return null;
    const [settings] = await db
      .select({ timezone: businessSettings.timezone })
      .from(businessSettings)
      .limit(1);
    const { during, ...rest } = row;
    return { ...rest, start: during.start, timezone: settings?.timezone ?? "America/New_York" };
  });
}

/**
 * Takes the "sent" stamp in one atomic UPDATE so two taps can't both send a text.
 * Returns the previous stamp (so a failed send can put it back), or "taken" when a
 * text went out in the last 30 minutes.
 */
export async function claimOnMyWay(
  slug: string,
  appointmentId: string,
): Promise<{ previous: Date | null } | "taken"> {
  return withTenantDb(slug, async (db, { appointments }) => {
    const [before] = await db
      .select({ at: appointments.onMyWaySentAt })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    const claimed = await db
      .update(appointments)
      .set({ onMyWaySentAt: sql`now()` })
      .where(
        and(
          eq(appointments.id, appointmentId),
          or(
            isNull(appointments.onMyWaySentAt),
            lt(
              appointments.onMyWaySentAt,
              sql`now() - make_interval(mins => ${ON_MY_WAY_COOLDOWN_MINUTES})`,
            ),
          ),
        ),
      )
      .returning({ id: appointments.id });
    return claimed.length === 0 ? "taken" : { previous: before?.at ?? null };
  });
}

export async function releaseOnMyWay(
  slug: string,
  appointmentId: string,
  previous: Date | null,
): Promise<void> {
  await withTenantDb(slug, async (db, { appointments }) =>
    db
      .update(appointments)
      .set({ onMyWaySentAt: previous })
      .where(eq(appointments.id, appointmentId)),
  );
}
