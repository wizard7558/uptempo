"use server";

import { getT } from "@/lib/terms/server";
import { and, eq, ne } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { memberships } from "@/lib/db/schema/memberships";
import { getTenantBySlug } from "@/lib/tenant/registry";

type DeleteResult =
  | { success: true }
  | { success: false; error: string; blockedSalons?: string[] };

/**
 * Self-serve deletion of the signed-in owner/staff account (Apple Guideline
 * 5.1.1(v)).
 *
 * Guard: if the user is the SOLE owner of any business, deletion is blocked — they
 * must transfer ownership (invite another owner) or close the business first, so a
 * business is never left ownerless and other staff/clients keep working. Once
 * another owner exists, deletion proceeds.
 *
 * On success the user row is deleted, which cascades sessions, OAuth accounts,
 * and memberships (all reference user.id with onDelete: cascade). Tenant data
 * (the business itself) is intentionally retained for the remaining owners.
 */
export async function deleteMyOwnerAccount(): Promise<DeleteResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return { success: false, error: "You are not signed in." };
  }

  try {
    // Businesses where this user is an owner.
    const ownerTenants = await publicDb
      .select({ tenantSlug: memberships.tenantSlug })
      .from(memberships)
      .where(
        and(eq(memberships.userId, userId), eq(memberships.role, "owner")),
      );

    // Block if they are the only owner of any of those businesses.
    const soleOwnerOf: string[] = [];
    for (const { tenantSlug } of ownerTenants) {
      const otherOwners = await publicDb
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantSlug, tenantSlug),
            eq(memberships.role, "owner"),
            ne(memberships.userId, userId),
          ),
        )
        .limit(1);

      if (otherOwners.length === 0) {
        const tenant = await getTenantBySlug(tenantSlug);
        soleOwnerOf.push(tenant?.name ?? tenantSlug);
      }
    }

    if (soleOwnerOf.length > 0) {
      return {
        success: false,
        error: (await getT("errors"))("ownerAccount.soleOwner", {
          names: soleOwnerOf.join(", "),
        }),
        blockedSalons: soleOwnerOf,
      };
    }

    // Safe to delete — cascades sessions, accounts, and memberships.
    await publicDb.delete(user).where(eq(user.id, userId));

    return { success: true };
  } catch (error) {
    console.error("[Account] deleteMyOwnerAccount failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to delete account";
    return { success: false, error: message };
  }
}
