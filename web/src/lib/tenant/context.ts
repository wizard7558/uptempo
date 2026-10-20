import { headers } from "next/headers";
import {
  previewTenantEnvApplies,
  resolvePreviewTenantSlug,
} from "@/lib/tenant/preview-tenant";
import { auth } from "@/lib/auth/server";
import { isSingleMode } from "@/lib/config/mode";
import { getSingleTenantSlug } from "@/lib/tenant/single";
import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { eq } from "drizzle-orm";

const TENANT_HEADER = "x-tenant-slug";

function requestHostname(headersList: Headers): string {
  const forwarded = headersList.get("x-forwarded-host");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim()?.split(":")[0] ?? "";
  }
  return headersList.get("host")?.split(":")[0] ?? "";
}

/**
 * Resolve the tenant slug from the middleware header, the authenticated user's
 * record, or an explicitly configured preview tenant.
 *
 * Order matters: `x-tenant-slug` (e.g. /book/:slug) wins first. If the user is
 * logged in with `user.tenant_slug` set, that wins before the preview slug so
 * admin/dashboard requests use the business they belong to instead of an
 * explicitly configured preview tenant (which would break feature gates like assistant seats).
 */
async function resolveSlug(): Promise<string | null> {
  if (isSingleMode()) return getSingleTenantSlug();

  const headersList = await headers();
  const fromHeader = headersList.get(TENANT_HEADER);
  if (fromHeader) {
    return fromHeader;
  }

  try {
    const session = await auth.api.getSession({ headers: headersList });
    if (session?.user?.id) {
      const [dbUser] = await publicDb
        .select({ tenantSlug: user.tenantSlug })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1);
      const fromUser = dbUser?.tenantSlug?.trim();
      if (fromUser) {
        return fromUser;
      }
    }
  } catch {
    // No session or DB read failed — fall through
  }

  const host = requestHostname(headersList);
  if (previewTenantEnvApplies(host)) {
    return resolvePreviewTenantSlug();
  }

  return null;
}

/**
 * Read tenant slug: middleware header, then authenticated user's tenant_slug,
 * then the explicitly configured preview slug when applicable.
 */
export async function getTenantSlug(): Promise<string> {
  const slug = await resolveSlug();
  if (!slug) {
    throw new Error(
      "No tenant context -- request did not pass through tenant middleware",
    );
  }
  return slug;
}

/**
 * Read tenant slug from request headers, returning null if not present.
 * Useful for routes that work both with and without tenant context.
 */
export async function getTenantSlugOrNull(): Promise<string | null> {
  return resolveSlug();
}
