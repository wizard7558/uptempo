import { getT } from "@/lib/terms/server";
import { notFound } from "next/navigation";
import { getBusinessBySlug } from "@/actions/booking-public";
import { listActiveMembershipPlansPublic } from "@/actions/membership";
import {
  getBookingSession,
  clearBookingSession,
} from "@/lib/booking/session-cookie";
import { withTenantDb } from "@/lib/db/tenant";
import { eq, and, ne, desc } from "drizzle-orm";
import { isTenantProvisioned } from "@/lib/tenant/registry";
import { salonPageMetadata } from "@/lib/seo/tenant-metadata";
import { SubscribeWizard } from "./subscribe-wizard";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getT("booking", slug);
  return salonPageMetadata(slug, (businessName) => ({
    title: `${businessName} membership`,
    description: t("subscribePage.metaDescription", { salonName: businessName }),
  }));
}

export default async function SubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const business = await getBusinessBySlug(slug);
  if (!business || !(await isTenantProvisioned(slug))) {
    notFound();
  }

  const plans = await listActiveMembershipPlansPublic(slug);
  const sessionClientId = await getBookingSession();
  const resumeClientId =
    typeof query.subscribe_client === "string" ? query.subscribe_client : null;
  const resumePlanIdRaw =
    typeof query.subscribe_plan === "string" ? query.subscribe_plan : null;
  const setupIntentClientSecret =
    typeof query.setup_intent_client_secret === "string"
      ? query.setup_intent_client_secret
      : null;

  let clientSession: { clientId: string; clientName: string } | null = null;
  let existingMembershipStatus: string | null = null;

  if (sessionClientId) {
    const row = await withTenantDb(slug, async (db, { clients, clientMemberships }) => {
      const [c] = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(eq(clients.id, sessionClientId))
        .limit(1);
      if (!c) {
        return {
          client: null as null | { id: string; name: string },
          membershipStatus: null as string | null,
        };
      }
      const [m] = await db
        .select({ status: clientMemberships.status })
        .from(clientMemberships)
        .where(
          and(
            eq(clientMemberships.clientId, c.id),
            ne(clientMemberships.status, "cancelled"),
          ),
        )
        .orderBy(desc(clientMemberships.createdAt))
        .limit(1);
      return { client: c, membershipStatus: m?.status ?? null };
    });

    if (!row.client) {
      await clearBookingSession();
    } else {
      clientSession = {
        clientId: row.client.id,
        clientName: row.client.name,
      };
      existingMembershipStatus = row.membershipStatus;
    }
  }

  const resumePlanId =
    clientSession &&
    resumeClientId === clientSession.clientId &&
    setupIntentClientSecret &&
    resumePlanIdRaw &&
    plans.some((plan) => plan.id === resumePlanIdRaw)
      ? resumePlanIdRaw
      : null;

  return (
    <SubscribeWizard
      salonId={business.id}
      salonName={business.name}
      tenantSlug={slug}
      plans={plans}
      clientSession={clientSession}
      existingMembershipStatus={existingMembershipStatus}
      resumePlanId={resumePlanId}
    />
  );
}
