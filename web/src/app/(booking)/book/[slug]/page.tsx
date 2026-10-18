import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getStaffServices } from "@/actions/booking-public";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { getBusinessSettingsForTenant } from "@/lib/policies/salon-policy";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { eq } from "drizzle-orm";
import { clearBookingSession } from "@/lib/booking/session-cookie";
import {
  getSalonBySlugCached,
  getBookingBrandingCached,
} from "@/lib/booking/cached-lookups";
import { getTenantBySlug, isTenantProvisioned } from "@/lib/tenant/registry";
import { isBookingPageOpen } from "@/lib/onboarding/state";
import { getT } from "@/lib/terms/server";
import { salonPageMetadata } from "@/lib/seo/tenant-metadata";
import { BookingPageSkeleton } from "@/components/booking-public/page-skeletons";
import { BookingWizard } from "./booking-wizard";
import { getPublicBookingFlow } from "@/lib/requests/flow";
import { loadRequestWizardProps } from "@/lib/requests/wizard-props";
import { RequestWizard } from "@/components/booking-public/request-wizard";
import { hasModule } from "@/lib/tenant/modules";
import { hasUpcomingClasses } from "@/lib/classes/public";
import { ClassScheduleCard } from "./classes/class-schedule";
import { getBookingVerificationChannel } from "@/lib/booking/verification-channel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return salonPageMetadata(slug, (salonName) => ({
    title: `Book at ${salonName}`,
    description: `Book your next appointment at ${salonName} — pick your service and time online, 24/7.`,
  }));
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  // Flush the branded shell immediately; the data-dependent wizard streams
  // in behind the skeleton (this is the native app's Book tab).
  return (
    <Suspense fallback={<BookingPageSkeleton />}>
      <BookingPageContent slug={slug} query={query} />
    </Suspense>
  );
}

async function BookingPageContent({
  slug,
  query,
}: {
  slug: string;
  query: Record<string, string | string[] | undefined>;
}) {

  // Extract reschedule pre-fill params
  const rescheduleId = typeof query.reschedule === "string" ? query.reschedule : undefined;
  const prefillStaffId =
    (typeof query.staff === "string" ? query.staff : undefined) ??
    (typeof query.stylist === "string" ? query.stylist : undefined);
  const prefillServiceIds = typeof query.services === "string"
    ? query.services.split(",").filter(Boolean)
    : undefined;
  const locationParam =
    typeof query.location === "string" ? query.location.trim() : undefined;

  const salon = await getSalonBySlugCached(slug);
  if (!salon || !(await isTenantProvisioned(slug))) {
    notFound();
  }

  const registryTenant = await getTenantBySlug(slug);
  if (registryTenant && !isBookingPageOpen(registryTenant.onboardingSteps)) {
    const t = await getT("booking", slug);
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-medium">{salon.name}</h1>
        <p className="mt-3 text-sm">{t("unpublished")}</p>
      </main>
    );
  }

  const tenantSlug = await getTenantSlug();
  const sessionClientId = await getBookingSession();

  // Policy, branding, and the returning-client lookup are independent — run
  // them as one parallel round trip instead of three serial ones. This page
  // is the native app's Book tab, so its TTFB is the tab's perceived latency.
  const [policy, branding, sessionClient] = await Promise.all([
    getBusinessSettingsForTenant(tenantSlug),
    getBookingBrandingCached(tenantSlug),
    sessionClientId
      ? withTenantDb(tenantSlug, async (db, { clients }) => {
          const [c] = await db
            .select({ id: clients.id, name: clients.name, phone: clients.phone })
            .from(clients)
            .where(eq(clients.id, sessionClientId))
            .limit(1);
          return c ?? null;
        })
      : Promise.resolve(null),
  ]);

  const salonTimezone = policy.timezone;
  const hasSalonLogo = Boolean(branding?.logoUrl?.trim());

  // Check for returning client session
  let clientSession: { clientId: string; clientName: string; clientPhone: string | null } | null = null;
  if (sessionClient) {
    clientSession = {
      clientId: sessionClient.id,
      clientName: sessionClient.name,
      clientPhone: sessionClient.phone,
    };
  } else if (sessionClientId) {
    // Client record was deleted -- clear stale cookie
    await clearBookingSession();
  }

  // Resolve a per-location booking link (?location=<id|name>) to a real location id.
  let prefillLocationId: string | undefined;
  if (locationParam) {
    prefillLocationId = await withTenantDb(
      tenantSlug,
      async (db, { locations }) => {
        const active = await db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(eq(locations.isActive, 1));
        const lower = locationParam.toLowerCase();
        const match =
          active.find((l) => l.id === locationParam) ??
          active.find((l) => l.name.toLowerCase() === lower);
        return match?.id;
      },
    );
  }

  // Resolve prefill display data server-side (stylist name, service summary, duration)
  let prefillStaffName: string | undefined;
  let prefillServiceSummary: string | undefined;
  let prefillTotalDuration: number | undefined;

  if (prefillStaffId && prefillServiceIds?.length) {
    const staffMember = await withTenantDb(tenantSlug, async (db, { staff }) => {
      const [s] = await db
        .select({ displayName: staff.displayName })
        .from(staff)
        .where(eq(staff.id, prefillStaffId))
        .limit(1);
      return s;
    });
    prefillStaffName = staffMember?.displayName;

    const { services: allServices } = await getStaffServices(
      prefillStaffId,
      clientSession?.clientId ?? null,
    );
    const matched = allServices.filter((s) => prefillServiceIds.includes(s.serviceId));
    if (matched.length) {
      prefillServiceSummary = matched.map((s) => s.serviceName).join(", ");
      prefillTotalDuration = matched.reduce((sum, s) => sum + s.durationMinutes, 0);
    }
  }

  // Request-first businesses (tattoo, home services) open on the request form
  // when the module is on. ?flow=book always forces the classic wizard.
  const flow = query.flow === "book" ? "book" : await getPublicBookingFlow(tenantSlug);
  if (flow === "request") {
    return <RequestWizard {...(await loadRequestWizardProps(tenantSlug, salon))} />;
  }
  // Class-first businesses open on the schedule. ?flow=book still reaches the wizard.
  if (flow === "class") redirect(`/book/${slug}/classes`);

  // Other businesses with classes on offer show a card above the wizard.
  const [showClassCard, waitlistEnabled] = await Promise.all([
    hasModule(tenantSlug, "classes").then(async (on) => on && (await hasUpcomingClasses(tenantSlug))),
    hasModule(tenantSlug, "slot_waitlist"),
  ]);

  const wizard = (
    <BookingWizard
      verificationChannel={getBookingVerificationChannel()}
      salonId={salon.id}
      salonSlug={slug}
      salonName={salon.name}
      hasSalonLogo={hasSalonLogo}
      salonTimezone={salonTimezone}
      requireCardOnFile={policy.requireCardOnFile === 1}
      clientSession={clientSession}
      waitlistEnabled={waitlistEnabled}
      clientPhone={sessionClient?.phone ?? null}
      prefillStaffId={prefillStaffId}
      prefillServiceIds={prefillServiceIds}
      prefillStaffName={prefillStaffName}
      prefillServiceSummary={prefillServiceSummary}
      prefillTotalDuration={prefillTotalDuration}
      prefillLocationId={prefillLocationId}
      reschedulingAppointmentId={rescheduleId}
    />
  );

  return showClassCard ? (
    <>
      <ClassScheduleCard slug={slug} />
      {wizard}
    </>
  ) : (
    wizard
  );
}
