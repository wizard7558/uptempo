import { and, asc, eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { getVertical } from "@/lib/verticals";
import { getBookingSession, clearBookingSession } from "@/lib/booking/session-cookie";
import { getBookingBrandingCached } from "@/lib/booking/cached-lookups";
import { resolveRequestFields } from "./fields";
import { earliestOpening, loadBooks, openStaffIds } from "./books";
import { loadSchedulingSettings } from "@/lib/scheduling/load";
import { getBookingVerificationChannel } from "@/lib/booking/verification-channel";
import type { RequestWizardProps } from "@/components/booking-public/request-wizard";

/** Everything the public request form needs, loaded for one tenant. */
export async function loadRequestWizardProps(
  slug: string,
  salon: { id: string; name: string },
): Promise<RequestWizardProps> {
  const tenant = await getTenantBySlug(slug);
  const vertical = getVertical(tenant?.industry);
  const sessionClientId = await getBookingSession();

  const [branding, data] = await Promise.all([
    getBookingBrandingCached(slug),
    withTenantDb(slug, async (db, { services, staff, clients }) => {
      const [serviceRows, staffRows, client] = await Promise.all([
        db
          .select({ id: services.id, name: services.name })
          .from(services)
          .where(and(eq(services.isActive, 1), eq(services.onlineBookable, 1)))
          .orderBy(asc(services.name)),
        db
          .select({ id: staff.id, displayName: staff.displayName })
          .from(staff)
          .where(eq(staff.isActive, 1))
          .orderBy(asc(staff.displayName)),
        sessionClientId
          ? db
              .select({ id: clients.id, name: clients.name })
              .from(clients)
              .where(eq(clients.id, sessionClientId))
              .limit(1)
              .then((r) => r[0] ?? null)
          : Promise.resolve(null),
      ]);
      return { serviceRows, staffRows, client };
    }),
  ]);

  if (sessionClientId && !data.client) await clearBookingSession();

  // Only people taking requests right now can be picked. With nobody open, the page shows
  // the "Books are closed" panel instead of the form.
  const now = new Date();
  const books = await loadBooks(slug, null, now);
  const open = new Set(openStaffIds(books.staff, books.windows, now));
  const staff = data.staffRows.filter((s) => open.has(s.id) || !books.staff.some((b) => b.id === s.id));
  const booksClosed = books.staff.length > 0 && open.size === 0;
  let booksClosedDate: string | null = null;
  if (booksClosed) {
    const next = earliestOpening(books.staff, books.windows, now);
    if (next) {
      const { timezone } = await loadSchedulingSettings(slug);
      booksClosedDate = new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeZone: timezone,
      }).format(next);
    }
  }

  return {
    verificationChannel: getBookingVerificationChannel(),
    salonId: salon.id,
    salonName: salon.name,
    hasSalonLogo: Boolean(branding?.logoUrl?.trim()),
    clientSession: data.client ? { clientId: data.client.id, clientName: data.client.name } : null,
    fields: resolveRequestFields(vertical.requestFields),
    services: data.serviceRows,
    staff,
    booksClosed,
    booksClosedDate,
  };
}
