"use server";

import { AuthError, requireStaff } from "@/lib/auth/rbac";

import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { updateBrandingSchema } from "@/lib/validators/branding";
import { eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { trackEvent } from "@/lib/analytics/events";
import { uploadLogoToBlobStorage } from "@/lib/branding/logo-blob-upload";

export async function getBrandingSettings() {
  const { tenantSlug: slug } = await requireStaff();
  return withTenantDb(slug, async (db, { brandingSettings }) => {
    const [settings] = await db
      .select()
      .from(brandingSettings)
      .limit(1);

    if (settings) return settings;

    // Create default branding settings if none exists (singleton pattern)
    const [newSettings] = await db
      .insert(brandingSettings)
      .values({})
      .returning();

    return newSettings;
  });
}

export async function updateBrandingSettings(data: {
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string | null;
  fontPreference?: string;
  brandColor?: string;
  fontPairing?: "score" | "sans";
  cornerStyle?: "square" | "soft" | "round";
  density?: "comfortable" | "compact";
  colorMode?: "light" | "dark";
  showPoweredBy?: number;
}) {
  const { tenantSlug: slug } = await requireStaff();
  const parsed = updateBrandingSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.flatten() };
  }

  try {

    // Ensure a branding settings row exists first
    const existingSettings = await getBrandingSettings();

    const result = await withTenantDb(slug, async (db, { brandingSettings }) => {
      return db
        .update(brandingSettings)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(brandingSettings.id, existingSettings.id))
        .returning();
    });

    if (result.length === 0) {
      return {
        success: false as const,
        error: {
          formErrors: [],
          fieldErrors: {},
          message: "Branding settings not found",
        },
      };
    }

    revalidatePath("/settings/branding");
    // Invalidate the cross-request branding cache used by the public booking
    // layout/metadata (src/lib/booking/cached-lookups.ts).
    revalidateTag(`branding:${slug}`);
    trackEvent("branding.updated", {}, { tenantSlug: slug });
    return { success: true as const, data: result[0] };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return {
      success: false as const,
      error: {
        formErrors: [],
        fieldErrors: {},
        message: "Failed to update branding settings",
      },
    };
  }
}

/**
 * Public read function for booking page branding.
 * Returns branding settings or null if none exist.
 * Does NOT auto-create a row -- the booking page should handle null gracefully.
 */
export async function getBrandingForBooking() {
  const slug = await getTenantSlug();
  return withTenantDb(slug, async (db, { brandingSettings }) => {
    const [settings] = await db
      .select()
      .from(brandingSettings)
      .limit(1);

    return settings ?? null;
  });
}

/**
 * Upload a new business logo to Vercel Blob via Server Action (multipart).
 * Prefer this over `/api/upload/logo` — route handlers can return non-JSON 502s
 * behind Edge middleware / proxies on some deployments.
 */
export async function uploadBusinessLogo(formData: FormData): Promise<
  | { ok: true; url: string }
  | { ok: false; error: string; detail?: string }
> {
  await requireStaff();
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return { ok: false, error: "Unauthorized" };
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: "No file provided" };
    }

    const oldRaw = formData.get("oldUrl");
    const oldUrl =
      typeof oldRaw === "string" && oldRaw.trim().length > 0
        ? oldRaw.trim()
        : null;

    const result = await uploadLogoToBlobStorage({
      userId: session.user.id,
      file,
      oldUrl,
    });

    if (!result.ok) {
      return { ok: false, error: result.error, detail: result.detail };
    }

    trackEvent(
      "branding.logo_uploaded",
      { fileType: file.type || "unknown", fileSizeBytes: file.size },
      { userId: session.user.id },
    );

    return { ok: true, url: result.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[uploadBusinessLogo] Unhandled:", message);
    return {
      ok: false,
      error: "Logo upload failed unexpectedly.",
      detail:
        process.env.NODE_ENV === "development"
          ? message
          : "Check Vercel function logs for [uploadBusinessLogo].",
    };
  }
}
