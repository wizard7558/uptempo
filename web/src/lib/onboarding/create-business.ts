import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { tenants } from "@/lib/db/schema/tenants";
import { hairSalon } from "@/lib/verticals/hair-salon";
import { createTermsT } from "@/lib/terms/translator";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth/server";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { trackEvent, identifyUser } from "@/lib/analytics/events";
import { insertMembership } from "@/lib/db/membership-helpers";
import { newTenantShard } from "@/lib/db/shards";
import { getVertical, type VerticalId } from "@/lib/verticals";

const signupT = () => createTermsT(hairSalon.terms, "errors");

async function generateUniqueSlug(businessName: string): Promise<string> {
  const base =
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^[^a-z]+/, "")
      .replace(/-+$/, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "business";

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

export async function createBusinessAccount(data: {
  businessName: string;
  timezone: string;
  ownerName: string;
  email: string;
  password: string;
  industry: VerticalId;
}): Promise<{ success: true; slug: string } | { success: false; error: string }> {
  try {
    const slug = await generateUniqueSlug(data.businessName);
    const vertical = getVertical(data.industry);

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

    try {
      await publicDb.insert(tenants).values({
        name: data.businessName,
        slug,
        timezone: data.timezone,
        schemaVersion: 0,
        industry: data.industry,
        modules: [...vertical.modules],
        dbShard: newTenantShard(),
        onboardingSteps: {
          profile: true,
          services: false,
          hours: false,
          stripe: false,
          launched: false,
        },
      });

      await publicDb
        .update(user)
        .set({ role: "owner", tenantSlug: slug })
        .where(eq(user.id, newUser.user.id));
      await insertMembership(newUser.user.id, slug, "owner");
    } catch (tenantError) {
      try {
        await publicDb.delete(user).where(eq(user.id, newUser.user.id));
      } catch {
        /* best-effort cleanup */
      }
      throw tenantError;
    }

    identifyUser(newUser.user.id, {
      email: data.email,
      name: data.ownerName,
      tenantSlug: slug,
      role: "owner",
    });
    trackEvent(
      "salon.signup",
      { method: "email", slug },
      { tenantSlug: slug, userId: newUser.user.id },
    );
    return { success: true, slug };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      (error.message?.includes("unique") || error.message?.includes("UNIQUE"))
    ) {
      return { success: false, error: "An account with this email already exists" };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : signupT()("onboarding.createAccountFailed"),
    };
  }
}
