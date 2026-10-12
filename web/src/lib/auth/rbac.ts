import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import { user } from "@/lib/db/schema/auth";
import { getMembershipRoleForActiveTenant } from "@/lib/db/membership-helpers";
import { cache } from "react";
import { normalizeTeamRole, type TeamRole } from "@/lib/auth/permissions";

type AdminRole = TeamRole;

const ALL_TEAM_ROLES: readonly TeamRole[] = [
  "owner",
  "admin",
  "provider",
  "assistant",
];

export type AuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NO_TENANT";

/**
 * Thrown by `requireStaff` when a server action caller is not allowed.
 * Server actions must not redirect, so they throw this instead.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}

const getCurrentUserTenant = cache(
  async (): Promise<{ userId: string; tenantSlug: string | null } | null> => {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) return null;

    const [dbUser] = await db
      .select({ tenantSlug: user.tenantSlug })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    return {
      userId: session.user.id,
      tenantSlug: dbUser?.tenantSlug ?? null,
    };
  },
);

/**
 * Get the current user's role for their active tenant (memberships + user.tenant_slug).
 * Returns null if no session, no tenant context, or no membership row.
 */
export async function getUserRole(): Promise<string | null> {
  const session = await getCurrentUserTenant();
  if (!session) return null;
  return getMembershipRoleForActiveTenant(
    session.userId,
    session.tenantSlug,
  );
}

/**
 * Require the current user to have an admin role (owner, admin, provider, assistant).
 * Redirects to /login if not authenticated, /unauthorized if wrong role.
 * Use in server components and layouts.
 */
export async function requireAdminRole(): Promise<{
  userId: string;
  role: AdminRole;
  tenantSlug: string | null;
}> {
  const session = await getCurrentUserTenant();
  if (!session) redirect("/login");
  const tenantSlug = session.tenantSlug;
  const raw = await getMembershipRoleForActiveTenant(
    session.userId,
    tenantSlug,
  );
  const role = raw == null ? null : normalizeTeamRole(raw);
  if (
    role !== "owner" &&
    role !== "admin" &&
    role !== "provider" &&
    role !== "assistant"
  ) {
    redirect("/unauthorized");
  }
  return {
    userId: session.userId,
    role,
    tenantSlug,
  };
}

/**
 * Require the current user to be an owner in their active tenant.
 * Redirects to /login if not authenticated, /unauthorized if not owner.
 */
export async function requireOwnerRole(): Promise<{
  userId: string;
  role: "owner";
  tenantSlug: string | null;
}> {
  const session = await getCurrentUserTenant();
  if (!session) redirect("/login");
  const tenantSlug = session.tenantSlug;
  const role = await getMembershipRoleForActiveTenant(
    session.userId,
    tenantSlug,
  );
  if (role !== "owner") {
    redirect("/unauthorized");
  }
  return {
    userId: session.userId,
    role: "owner",
    tenantSlug,
  };
}

/**
 * Same lookup as `requireRole`, but returns null instead of redirecting.
 * For API routes that must answer 403 rather than send the browser to a page.
 */
export async function getActiveStaffRole(): Promise<{
  userId: string;
  role: AdminRole;
  tenantSlug: string | null;
} | null> {
  const session = await getCurrentUserTenant();
  if (!session) return null;
  const raw = await getMembershipRoleForActiveTenant(
    session.userId,
    session.tenantSlug,
  );
  const role = raw == null ? null : normalizeTeamRole(raw);
  if (!role) return null;
  return {
    userId: session.userId,
    role: role as AdminRole,
    tenantSlug: session.tenantSlug,
  };
}

/**
 * Require the current user to have one of the specified roles in their active tenant.
 * Redirects to /login if not authenticated, /unauthorized if role not in list.
 */
export async function requireRole(
  ...allowedRoles: AdminRole[]
): Promise<{
  userId: string;
  role: AdminRole;
  tenantSlug: string | null;
}> {
  const session = await getCurrentUserTenant();
  if (!session) redirect("/login");
  const tenantSlug = session.tenantSlug;
  const raw = await getMembershipRoleForActiveTenant(
    session.userId,
    tenantSlug,
  );
  const role = raw == null ? null : normalizeTeamRole(raw);
  if (!role || !allowedRoles.includes(role as AdminRole)) {
    redirect("/unauthorized");
  }
  return {
    userId: session.userId,
    role: role as AdminRole,
    tenantSlug,
  };
}

/**
 * Guard for server actions that only staff may run.
 *
 * Throws `AuthError` (never redirects) when there is no session, the
 * session user has no active tenant, or their role in that tenant is not
 * allowed. With no `roles`, every `TeamRole` is allowed.
 *
 * The returned `tenantSlug` comes only from the session user's own record.
 * It never reads `x-tenant-slug` or `getTenantSlug()`.
 */
export async function requireStaff(...roles: TeamRole[]): Promise<{
  userId: string;
  role: TeamRole;
  tenantSlug: string;
}> {
  const allowed = roles.length > 0 ? roles : ALL_TEAM_ROLES;
  const session = await getCurrentUserTenant();
  if (!session) throw new AuthError("UNAUTHENTICATED", "Not signed in");
  const tenantSlug = session.tenantSlug?.trim();
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const raw = await getMembershipRoleForActiveTenant(
    session.userId,
    tenantSlug,
  );
  const role = raw == null ? null : normalizeTeamRole(raw);
  if (!role || !(allowed as readonly string[]).includes(role)) {
    throw new AuthError("FORBIDDEN", "Not allowed");
  }
  return {
    userId: session.userId,
    role: role as TeamRole,
    tenantSlug,
  };
}
