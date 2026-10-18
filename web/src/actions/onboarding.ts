"use server";

import { AuthError, requireStaff } from "@/lib/auth/rbac";

import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { tenants } from "@/lib/db/schema/tenants";
import { VERTICALS, VERTICAL_IDS, type Vertical } from "@/lib/verticals";
import { isSingleMode } from "@/lib/config/mode";
import { syncBillableStaff } from "@/lib/billing/billable-staff";
import { getT } from "@/lib/terms/server";
import { createTermsT } from "@/lib/terms/translator";
import { eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { getTenantBySlug, updateTenantOnboardingSteps } from "@/lib/tenant/registry";
import { slugSchema } from "@/lib/tenant/slug-validation";
import { withTenantDb } from "@/lib/db/tenant";
import { SERVICE_TEMPLATES, templateToServiceRow } from "@/lib/onboarding/service-templates";
import { trackEvent, identifyUser } from "@/lib/analytics/events";
import { ensureHostedSubscription } from "@/lib/billing/subscriptions";
import { HOSTED_TRIAL_DAYS } from "@/lib/billing/hosted-pricing";
import {
  addMembershipAndActivate,
  insertMembership,
  getMembershipRoleForActiveTenant,
} from "@/lib/db/membership-helpers";
import {
  onboardingTag,
  readStoredSteps,
  getMissingLaunchPrereqs,
  isMarkableStep,
  type OnboardingState,
  type LaunchPrereq,
} from "@/lib/onboarding/state";

const ONBOARDING_CACHE_TTL_SECONDS = 60;

/** Signup copy follows the pack the owner just picked. Before that, use general. */
const signupT = (pack: Vertical = VERTICALS.general) =>
  createTermsT(pack.terms, "errors");

function requirePack(
  raw: unknown,
): { ok: true; pack: Vertical } | { ok: false; error: string } {
  const parsed = z.enum(VERTICAL_IDS).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: signupT()("onboarding.badIndustry") };
  }
  return { ok: true, pack: VERTICALS[parsed.data] };
}

function newTenantValues(data: {
  name: string;
  slug: string;
  timezone: string;
  pack: Vertical;
}) {
  return {
    name: data.name,
    slug: data.slug,
    timezone: data.timezone,
    schemaVersion: 0,
    industry: data.pack.id,
    modules: [...data.pack.modules],
    onboardingSteps: {
      profile: true,
      services: false,
      hours: false,
      stripe: false,
      launched: false,
    },
  };
}

/**
 * Get the tenant slug for the current user. During onboarding the user is on
 * the root domain (no tenant middleware), so we fall back to the user's
 * tenantSlug column in the database.
 */
async function getOnboardingSlug(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) throw new Error("Not authenticated");

  const [dbUser] = await publicDb
    .select({ tenantSlug: user.tenantSlug })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (!dbUser?.tenantSlug) throw new Error("No tenant linked to this account");
  return dbUser.tenantSlug;
}

/**
 * Slug + role for the current user's active tenant, requiring owner/admin.
 * Onboarding mutations run on the root domain and are called from a public
 * server-action surface, so they must enforce their own role check (a stylist
 * or assistant must not be able to flip flags or launch the salon).
 */
async function getOnboardingSlugAsManager(): Promise<
  { ok: true; slug: string } | { ok: false; error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return { ok: false, error: "Not authenticated" };

  const [dbUser] = await publicDb
    .select({ tenantSlug: user.tenantSlug })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);
  if (!dbUser?.tenantSlug) {
    return { ok: false, error: "No tenant linked to this account" };
  }

  const role = await getMembershipRoleForActiveTenant(
    session.user.id,
    dbUser.tenantSlug,
  );
  if (role !== "owner" && role !== "admin") {
    return {
      ok: false,
      error: (await getT("errors", dbUser.tenantSlug))("onboarding.ownerOnly"),
    };
  }
  return { ok: true, slug: dbUser.tenantSlug };
}

export async function checkSlugAvailability(slug: string): Promise<{ available: boolean; error?: string }> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) {
    return { available: false, error: parsed.error.issues[0]?.message ?? "Invalid slug" };
  }

  const existing = await getTenantBySlug(slug);
  if (existing) {
    return { available: false, error: "This slug is already taken" };
  }

  return { available: true };
}

/**
 * Generate a URL-safe slug from a salon name, appending a suffix if taken.
 */
async function generateUniqueSlug(salonName: string): Promise<string> {
  const base = salonName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "salon";

  if (base.length >= 3) {
    const existing = await getTenantBySlug(base);
    if (!existing) return base;
  }

  for (let i = 0; i < 10; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    const existing = await getTenantBySlug(candidate);
    if (!existing) return candidate;
  }

  return `${base}-${Date.now().toString(36)}`;
}

const SIGNUP_OFF = "Sign-up is turned off on this install.";

export async function createSalonAccount(data: {
  salonName: string;
  timezone: string;
  ownerName: string;
  email: string;
  password: string;
  industry: string;
}): Promise<{ success: true; slug: string } | { success: false; error: string }> {
  if (isSingleMode()) return { success: false, error: SIGNUP_OFF };
  const packResult = requirePack(data.industry);
  if (!packResult.ok) return { success: false, error: packResult.error };
  const pack = packResult.pack;
  try {
    // Auto-generate a unique slug from salon name
    const slug = await generateUniqueSlug(data.salonName);

    // Create the user via Better Auth
    const newUser = await auth.api.signUpEmail({
      body: {
        name: data.ownerName,
        email: data.email,
        password: data.password,
      },
    });

    if (!newUser?.user?.id) {
      return { success: false, error: "Failed to create account" };
    }

    // Create tenant registry row (fast — no schema provisioning yet)
    // ensureTenantProvisioned() handles the actual DDL on onboarding page load
    try {
      await publicDb.insert(tenants).values(
        newTenantValues({
          name: data.salonName,
          slug,
          timezone: data.timezone,
          pack,
        }),
      );

      // Update user: set role to owner and link tenant
      await publicDb
        .update(user)
        .set({ role: "owner", tenantSlug: slug })
        .where(eq(user.id, newUser.user.id));
      await insertMembership(newUser.user.id, slug, "owner");
    } catch (tenantError) {
    if (tenantError instanceof AuthError) throw tenantError;
      // Clean up the orphaned auth user so they can retry signup
      try {
        await publicDb.delete(user).where(eq(user.id, newUser.user.id));
      } catch (err) {
    if (err instanceof AuthError) throw err; /* best-effort cleanup */ }
      throw tenantError;
    }

    identifyUser(newUser.user.id, { email: data.email, name: data.ownerName, tenantSlug: slug, role: "owner" });
    trackEvent("salon.signup", { method: "email", slug }, { tenantSlug: slug, userId: newUser.user.id });
    return { success: true, slug };
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    // Handle duplicate email
    if (error instanceof Error && (error.message?.includes("unique") || error.message?.includes("UNIQUE"))) {
      return { success: false, error: "An account with this email already exists" };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : signupT(pack)("onboarding.createAccountFailed"),
    };
  }
}

export async function setupSalonForOAuthUser(data: {
  salonName: string;
  slug: string;
  timezone: string;
  industry: string;
}): Promise<{ success: true; slug: string } | { success: false; error: string }> {
  if (isSingleMode()) return { success: false, error: SIGNUP_OFF };
  const packResult = requirePack(data.industry);
  if (!packResult.ok) return { success: false, error: packResult.error };
  const pack = packResult.pack;
  try {
    // Get current session
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    // Validate slug format
    const slugResult = slugSchema.safeParse(data.slug);
    if (!slugResult.success) {
      return { success: false, error: slugResult.error.issues[0]?.message ?? "Invalid slug" };
    }

    // Check slug uniqueness
    const existing = await getTenantBySlug(data.slug);
    if (existing) {
      return { success: false, error: "This booking URL is already taken" };
    }

    // Create tenant registry row (fast — no schema provisioning yet)
    await publicDb.insert(tenants).values(
      newTenantValues({
        name: data.salonName,
        slug: data.slug,
        timezone: data.timezone,
        pack,
      }),
    );

    await addMembershipAndActivate(session.user.id, data.slug, "owner");

    identifyUser(session.user.id, { email: session.user.email, name: session.user.name ?? undefined, tenantSlug: data.slug, role: "owner" });
    trackEvent("salon.signup", { method: "oauth", slug: data.slug }, { tenantSlug: data.slug, userId: session.user.id });
    return { success: true, slug: data.slug };
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    if (error instanceof Error && error.message?.includes("unique")) {
      return { success: false, error: "This booking URL is already taken" };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : signupT(pack)("onboarding.setupFailed"),
    };
  }
}

/**
 * For a user who already belongs to at least one salon (e.g. assistant on another account):
 * create a **new** tenant, add an owner membership, and switch their active salon to it.
 * Existing memberships are unchanged — they can switch salons from the sidebar.
 */
export async function createAdditionalSalonAsOwner(data: {
  salonName: string;
  slug: string;
  timezone: string;
  industry: string;
}): Promise<{ success: true; slug: string } | { success: false; error: string }> {
  if (isSingleMode()) return { success: false, error: SIGNUP_OFF };
  const packResult = requirePack(data.industry);
  if (!packResult.ok) return { success: false, error: packResult.error };
  const pack = packResult.pack;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    const slugResult = slugSchema.safeParse(data.slug);
    if (!slugResult.success) {
      return { success: false, error: slugResult.error.issues[0]?.message ?? "Invalid slug" };
    }

    const existing = await getTenantBySlug(data.slug);
    if (existing) {
      return { success: false, error: "This booking URL is already taken" };
    }

    await publicDb.insert(tenants).values(
      newTenantValues({
        name: data.salonName,
        slug: data.slug,
        timezone: data.timezone,
        pack,
      }),
    );

    await addMembershipAndActivate(session.user.id, data.slug, "owner");

    identifyUser(session.user.id, {
      email: session.user.email,
      name: session.user.name ?? undefined,
      tenantSlug: data.slug,
      role: "owner",
    });
    trackEvent(
      "salon.signup",
      { method: "additional_salon", slug: data.slug },
      { tenantSlug: data.slug, userId: session.user.id },
    );
    revalidatePath("/", "layout");
    return { success: true, slug: data.slug };
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    if (error instanceof Error && error.message?.includes("unique")) {
      return { success: false, error: "This booking URL is already taken" };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : signupT(pack)("onboarding.createFailed"),
    };
  }
}

export async function saveBusinessDetails(input: {
  salonName: string;
  phone: string;
  address: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug, userId } = await requireStaff("owner", "admin");
  const salonName = input.salonName.trim();
  const phone = input.phone.trim();
  const address = input.address.trim();
  if (!salonName || !phone || !address) {
    return {
      success: false,
      error: (await getT("errors", tenantSlug))("onboarding.missingBusiness"),
    };
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  await publicDb
    .update(tenants)
    .set({ name: salonName, updatedAt: new Date() })
    .where(eq(tenants.slug, tenantSlug));

  await withTenantDb(tenantSlug, async (db, { staff, locations, businessSettings }) => {
    await db
      .update(staff)
      .set({ phone, updatedAt: new Date() })
      .where(eq(staff.userId, userId));

    const [location] = await db
      .select({ id: locations.id })
      .from(locations)
      .limit(1);
    if (location) {
      await db
        .update(locations)
        .set({ name: salonName, address, updatedAt: new Date() })
        .where(eq(locations.id, location.id));
    } else {
      await db.insert(locations).values({ name: salonName, address });
    }

    const [policy] = await db
      .select({ id: businessSettings.id })
      .from(businessSettings)
      .limit(1);
    if (policy) {
      await db
        .update(businessSettings)
        .set({ businessAddress: address, updatedAt: new Date() })
        .where(eq(businessSettings.id, policy.id));
    } else {
      await db.insert(businessSettings).values({
        timezone: tenant.timezone,
        businessAddress: address,
      });
    }
  });
  await syncBillableStaff(tenantSlug);

  revalidatePath("/onboarding");
  return { success: true };
}

export async function setOnboardingServicesActive(
  activeIds: string[],
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireStaff("owner", "admin");
  if (activeIds.length === 0) {
    return { success: false, error: "Keep at least one service on." };
  }
  await withTenantDb(tenantSlug, async (db, { services }) => {
    const now = new Date();
    await db
      .update(services)
      .set({ isActive: 0, updatedAt: now })
      .where(notInArray(services.id, activeIds));
    await db
      .update(services)
      .set({ isActive: 1, updatedAt: now })
      .where(inArray(services.id, activeIds));
  });
  revalidatePath("/services");
  revalidatePath("/onboarding");
  return { success: true };
}

export async function renameOnboardingForm(
  id: string,
  name: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireStaff("owner", "admin");
  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Name is required." };
  await withTenantDb(tenantSlug, async (db, { formTemplates }) => {
    await db
      .update(formTemplates)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(eq(formTemplates.id, id));
  });
  revalidatePath("/onboarding");
  return { success: true };
}

export async function seedServicesFromTemplates(
  templateIds: string[],
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  await requireStaff();
  try {
    const slug = await getOnboardingSlug();
    const selectedTemplates = SERVICE_TEMPLATES.filter((t) => templateIds.includes(t.id));

    if (selectedTemplates.length === 0) {
      return { success: false, error: "No valid templates selected" };
    }

    await withTenantDb(slug, async (db, { services }) => {
      await db.insert(services).values(
        selectedTemplates.map(templateToServiceRow),
      );
    });

    await markOnboardingStepComplete("services");
    revalidatePath("/services");

    trackEvent("onboarding.services_seeded", { count: selectedTemplates.length }, { tenantSlug: slug });
    return { success: true, count: selectedTemplates.length };
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    return { success: false, error: error instanceof Error ? error.message : "Failed to seed services" };
  }
}

/**
 * Live (uncached) counts backing the derived flags. Shared by state reads and
 * launch validation so "what counts as done" has one definition.
 */
async function computeOnboardingPrereqs(slug: string): Promise<{
  servicesCount: number;
  hoursCount: number;
}> {
  let servicesCount = 0;
  let hoursCount = 0;
  try {
    const [svc, hrs] = await withTenantDb(
      slug,
      async (db, { services, workingHours }) =>
        Promise.all([
          db.select({ count: sql<number>`count(*)` }).from(services),
          db.select({ count: sql<number>`count(*)` }).from(workingHours),
        ]),
    );
    servicesCount = Number(svc[0]?.count ?? 0);
    hoursCount = Number(hrs[0]?.count ?? 0);
  } catch (err) {
    if (err instanceof AuthError) throw err;
    // Tenant schema may not exist yet
  }
  return { servicesCount, hoursCount };
}

async function fetchOnboardingState(
  slug: string,
): Promise<OnboardingState | null> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return null;

  const stored = readStoredSteps(
    (tenant.onboardingSteps ?? {}) as Record<string, unknown>,
  );
  const { servicesCount, hoursCount } = await computeOnboardingPrereqs(slug);

  return {
    profile: true, // Always true once tenant exists
    services: servicesCount > 0,
    hours: hoursCount > 0,
    policies: stored.policies,
    stripe: tenant.stripeConnectAccountId !== null,
    stripeSkipped: stored.stripeSkipped,
    branding: stored.branding,
    launched: stored.launched,
  };
}

export async function getOnboardingState(
  slug: string,
): Promise<OnboardingState | null> {
  const { tenantSlug } = await requireStaff();
  if (slug !== tenantSlug) throw new AuthError("FORBIDDEN", "Not allowed");
  return unstable_cache(
    async () => fetchOnboardingState(slug),
    ["tenant-onboarding-state", slug],
    {
      revalidate: ONBOARDING_CACHE_TTL_SECONDS,
      tags: [onboardingTag(slug)],
    },
  )();
}

export async function markOnboardingStepComplete(
  step: string,
): Promise<{ success: boolean; error?: string }> {
  await requireStaff();
  if (!isMarkableStep(step)) {
    return { success: false, error: "Unknown onboarding step" };
  }
  const access = await getOnboardingSlugAsManager();
  if (!access.ok) return { success: false, error: access.error };
  const { slug } = access;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const currentSteps = (tenant.onboardingSteps ?? {}) as Record<string, boolean>;
  const updatedSteps = { ...currentSteps, [step]: true };

  await updateTenantOnboardingSteps(slug, updatedSteps);
  revalidatePath("/", "layout");
  revalidateTag(onboardingTag(slug));
  return { success: true };
}

/**
 * Mark the Hours step complete — but only if working hours actually exist
 * (the old flow let owners click Continue without saving anything).
 */
export async function completeHoursStep(): Promise<{
  success: boolean;
  error?: string;
}> {
  await requireStaff();
  const access = await getOnboardingSlugAsManager();
  if (!access.ok) return { success: false, error: access.error };

  const { hoursCount } = await computeOnboardingPrereqs(access.slug);
  if (hoursCount === 0) {
    return {
      success: false,
      error: "Set working hours for at least one day before continuing.",
    };
  }
  return markOnboardingStepComplete("hours");
}

/**
 * Explicitly skip Stripe during onboarding. Closes the card-on-file trap: a
 * salon without Stripe cannot process cards, so if `require_card_on_file` is
 * still on we turn it off (and say so) — otherwise the public booking flow
 * would demand cards it can't charge. A prompt on Settings → Billing offers to
 * re-enable it once Stripe is connected.
 */
export async function skipStripeForNow(): Promise<
  | { success: true; cardRequirementDisabled: boolean }
  | { success: false; error: string }
> {
  await requireStaff();
  const access = await getOnboardingSlugAsManager();
  if (!access.ok) return { success: false, error: access.error };
  const { slug } = access;

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  if (tenant.stripeConnectAccountId) {
    return {
      success: false,
      error: "Stripe is already connected — nothing to skip.",
    };
  }

  let cardRequirementDisabled = false;
  try {
    cardRequirementDisabled = await withTenantDb(
      slug,
      async (db, { businessSettings }) => {
        const [policy] = await db
          .select({
            id: businessSettings.id,
            requireCardOnFile: businessSettings.requireCardOnFile,
          })
          .from(businessSettings)
          .limit(1);
        if (policy && policy.requireCardOnFile === 1) {
          await db
            .update(businessSettings)
            .set({ requireCardOnFile: 0, updatedAt: new Date() })
            .where(eq(businessSettings.id, policy.id));
          return true;
        }
        return false;
      },
    );
  } catch (err) {
    if (err instanceof AuthError) throw err;
    // Policies row may not exist yet — nothing to disable.
  }

  const currentSteps = (tenant.onboardingSteps ?? {}) as Record<string, boolean>;
  await updateTenantOnboardingSteps(slug, {
    ...currentSteps,
    stripeSkipped: true,
  });
  revalidatePath("/", "layout");
  revalidateTag(onboardingTag(slug));

  trackEvent(
    "onboarding.stripe_skipped",
    { cardRequirementDisabled },
    { tenantSlug: slug },
  );
  return { success: true, cardRequirementDisabled };
}

export async function launchSalon(): Promise<
  | { success: true }
  | { success: false; error: string; missing?: LaunchPrereq[] }
> {
  await requireStaff();
  try {
    const access = await getOnboardingSlugAsManager();
    if (!access.ok) return { success: false, error: access.error };
    const { slug } = access;

    const tenant = await getTenantBySlug(slug);
    if (!tenant) {
      return { success: false, error: "Tenant not found" };
    }

    // Validate prerequisites FRESH (not through the 60s cache) so an owner who
    // just saved hours isn't rejected by stale state.
    const stored = readStoredSteps(
      (tenant.onboardingSteps ?? {}) as Record<string, unknown>,
    );
    const { servicesCount, hoursCount } = await computeOnboardingPrereqs(slug);
    const missing = getMissingLaunchPrereqs({
      services: servicesCount > 0,
      hours: hoursCount > 0,
      policies: stored.policies,
      stripe:
        tenant.stripeConnectAccountId !== null ||
        (isSingleMode() && !!process.env.STRIPE_SECRET_KEY),
      stripeSkipped: stored.stripeSkipped,
    });
    if (missing.length > 0) {
      trackEvent(
        "salon.launch_blocked",
        { missing: missing.join(",") },
        { tenantSlug: slug },
      );
      return {
        success: false,
        error: "A few things still need attention before launch.",
        missing,
      };
    }

    const currentSteps = (tenant.onboardingSteps ?? {}) as Record<string, boolean>;
    const updatedSteps = { ...currentSteps, launched: true };

    await updateTenantOnboardingSteps(slug, updatedSteps);
    revalidatePath("/", "layout");
    revalidateTag(onboardingTag(slug));

    trackEvent("salon.launched", {}, { tenantSlug: slug });

    // Start the hosted plan trial. A billing problem must never undo a launch.
    try {
      await ensureHostedSubscription(slug, { trialDays: HOSTED_TRIAL_DAYS });
    } catch (billingError) {
      console.error(
        `launchSalon: hosted subscription setup failed for ${slug}:`,
        billingError,
      );
    }
    return { success: true };
  } catch (error: unknown) {
    if (error instanceof AuthError) throw error;
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : (await getT("errors"))("onboarding.launchFailed"),
    };
  }
}
