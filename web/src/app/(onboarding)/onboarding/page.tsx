import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { eq } from "drizzle-orm";
import { getOnboardingState } from "@/actions/onboarding";
import { ensureTenantProvisioned } from "@/lib/onboarding/tenant-onboarding";
import { AuthError, getUserRole } from "@/lib/auth/rbac";
import { loadOnboardingReview, seedIndustryPack } from "@/lib/onboarding/pack-seed";
import { getT } from "@/lib/terms/server";
import { landingPathForRole } from "@/lib/auth/landing";
import { getBusinessSettings } from "@/actions/policies";
import { getBrandingSettings } from "@/actions/branding";
import { getConnectStatus } from "@/actions/connect";
import { OnboardingWizard } from "./onboarding-wizard";
import type { PolicyInitial } from "./policies-step";
import type { ConnectStatusInfo } from "./payments-step";
import type { BrandingSettingsData } from "./branding-step";
import { withTenantDb } from "@/lib/db/tenant";
import { asc } from "drizzle-orm";
import { isSingleMode } from "@/lib/config/mode";
import { getBaseUrl } from "@/lib/utils";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { groupWeek, type DaySchedule } from "@/lib/scheduling/week";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const sp = await searchParams;
  const stripeSetupComplete = sp.stripe_setup === "complete";
  const selfHosted = isSingleMode()
    ? {
        configured: Boolean(process.env.STRIPE_SECRET_KEY),
        webhookUrl: `${getBaseUrl()}/api/stripe/webhook`,
      }
    : null;

  // Get user's tenant slug
  const [dbUser] = await publicDb
    .select({ tenantSlug: user.tenantSlug })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  const tenantSlug = dbUser?.tenantSlug ?? null;

  // Google OAuth user without tenant setup
  if (!tenantSlug) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <OnboardingWizard
          steps={null}
          needsProfile={true}
          tenantSlug={null}
          staff={[]}
          initialHours={[]}
          locations={[]}
          policyInitial={null}
          brandingSettings={null}
          connectStatus={{ connected: false }}
          stripeSetupComplete={stripeSetupComplete}
          selfHosted={selfHosted}
          catalog={null}
        />
      </div>
    );
  }

  // Check if schema needs provisioning (schemaVersion === 0 means signup created
  // the tenant row but deferred the heavy DDL work for a fast signup experience)
  const tenant = await getTenantBySlug(tenantSlug);
  if (tenant && tenant.schemaVersion === 0) {
    await ensureTenantProvisioned(
      tenantSlug,
      session.user.id,
      session.user.name ?? "Owner",
      session.user.email,
    );
  }
  await seedIndustryPack(tenantSlug, session.user.id);
  const copy = await getT("onboarding", tenantSlug);
  const catalog = await loadOnboardingReview(tenantSlug, session.user.id, tenant?.name ?? "", {
    starterHours: copy("hoursSummary"),
    hoursMissing: copy("hoursMissing"),
  });

  // Check onboarding state
  const onboardingState = await getOnboardingState(tenantSlug);
  const homePath = landingPathForRole(await getUserRole());

  // A launched shop goes home. launchSalon revalidates this page, and that
  // re-render (a Next-Action request) must leave the owner on the link they
  // just published.
  if (onboardingState?.launched && !(await headers()).has("next-action")) {
    redirect(homePath);
  }

  // Fetch stylists and initial hours for the hours step
  let staff: Array<{ id: string; displayName: string }> = [];
  let initialHours: DaySchedule[] = [];
  let locations: Array<{ id: string; name: string; address: string | null }> = [];

  try {
    staff = await withTenantDb(tenantSlug, async (db, tables) => {
      return db
        .select({ id: tables.staff.id, displayName: tables.staff.displayName })
        .from(tables.staff)
        .where(eq(tables.staff.isActive, 1))
        .orderBy(asc(tables.staff.displayName));
    });

    locations = await withTenantDb(tenantSlug, async (db, tables) => {
      return db
        .select({
          id: tables.locations.id,
          name: tables.locations.name,
          address: tables.locations.address,
        })
        .from(tables.locations)
        .where(eq(tables.locations.isActive, 1))
        .orderBy(asc(tables.locations.createdAt), asc(tables.locations.name));
    });

    if (staff.length > 0) {
      const rows = await withTenantDb(tenantSlug, async (db, tables) => {
        return db
          .select()
          .from(tables.workingHours)
          .where(eq(tables.workingHours.staffId, staff[0].id))
          .orderBy(asc(tables.workingHours.dayOfWeek), asc(tables.workingHours.startTime));
      });
      initialHours = groupWeek(rows, locations[0]?.id ?? null);
    }
  } catch (err) {
    if (err instanceof AuthError) throw err;
  }

  // Data for the Policies, Payments, and Branding steps. Guarded because the
  // tenant schema may still be provisioning on the very first load.
  let policyInitial: PolicyInitial | null = null;
  let brandingSettings: BrandingSettingsData | null = null;
  let connectStatus: ConnectStatusInfo = { connected: false };

  try {
    const [policy, branding, connect] = await Promise.all([
      getBusinessSettings(),
      getBrandingSettings(),
      getConnectStatus(),
    ]);

    policyInitial = {
      cancellationWindowHours: policy.cancellationWindowHours,
      cancellationFeePercent: policy.cancellationFeePercent,
      noShowFeePercent: policy.noShowFeePercent,
      requireCardOnFile: policy.requireCardOnFile,
      policyText: policy.policyText,
      onlineBookingAudience: (policy.onlineBookingAudience ??
        "both") as "both" | "existing_only" | "new_only",
      depositEnabled: policy.depositEnabled ?? 0,
      depositDefaultType: (policy.depositDefaultType ?? "percent") as
        | "percent"
        | "fixed",
      depositDefaultAmount: policy.depositDefaultAmount ?? 0,
      depositDurationThresholdMinutes:
        policy.depositDurationThresholdMinutes ?? null,
    };
    brandingSettings = branding;
    connectStatus = connect;
  } catch (err) {
    if (err instanceof AuthError) throw err;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <OnboardingWizard
        steps={onboardingState}
        needsProfile={false}
        tenantSlug={tenantSlug}
        staff={staff.map((s) => ({ id: s.id, name: s.displayName }))}
        initialHours={initialHours}
        locations={locations}
        policyInitial={policyInitial}
        brandingSettings={brandingSettings}
        connectStatus={connectStatus}
        stripeSetupComplete={stripeSetupComplete}
        selfHosted={selfHosted}
        catalog={catalog}
        homePath={homePath}
      />
    </div>
  );
}
