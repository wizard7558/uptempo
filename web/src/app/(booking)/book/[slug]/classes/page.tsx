import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getTenantSlug } from "@/lib/tenant/context";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { hasModule } from "@/lib/tenant/modules";
import { getSalonBySlugCached } from "@/lib/booking/cached-lookups";
import { clearBookingSession, getBookingSession } from "@/lib/booking/session-cookie";
import { withTenantDb } from "@/lib/db/tenant";
import { getT } from "@/lib/terms/server";
import { listPublicClasses, myClassSpots } from "@/actions/classes-public";
import { localDay } from "@/lib/scheduling/intervals";
import { ClassSchedule } from "./class-schedule";

export default async function ClassesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const salon = await getSalonBySlugCached(slug);
  if (!salon || !(await isTenantProvisioned(slug))) notFound();
  const tenantSlug = await getTenantSlug();

  if (!(await hasModule(tenantSlug, "classes"))) {
    const t = await getT("classes", tenantSlug);
    return <p className="text-center text-sm font-light text-[var(--ink)]">{t("public.errors.CLOSED")}</p>;
  }

  const sessionClientId = await getBookingSession();
  const [list, mine, sessionClient] = await Promise.all([
    listPublicClasses(),
    myClassSpots(),
    sessionClientId
      ? withTenantDb(tenantSlug, async (db, { clients }) => {
          const [row] = await db
            .select({ id: clients.id, name: clients.name })
            .from(clients)
            .where(eq(clients.id, sessionClientId))
            .limit(1);
          return row ?? null;
        })
      : Promise.resolve(null),
  ]);
  if (sessionClientId && !sessionClient) await clearBookingSession();

  return (
    <ClassSchedule
      salonId={salon.id}
      salonName={salon.name}
      timezone={list.timezone}
      classes={list.classes}
      mine={mine}
      client={sessionClient ? { clientId: sessionClient.id, clientName: sessionClient.name } : null}
      today={localDay(new Date(), list.timezone)}
    />
  );
}
