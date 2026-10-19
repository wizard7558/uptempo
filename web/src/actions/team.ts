"use server";

import { getEmailT } from "@/lib/terms/email";
import { getEmailBranding } from "@/lib/email/branding";
import { getTenantTerms } from "@/lib/tenant/industry";
import { teamRoleLabel } from "@/lib/terms/role-label";
import { getT } from "@/lib/terms/server";
import { publicDb } from "@/lib/db";
import { teamInvitations } from "@/lib/db/schema/team-invitations";
import { user } from "@/lib/db/schema/auth";
import { tenants } from "@/lib/db/schema/tenants";
import { memberships } from "@/lib/db/schema/memberships";
import { AuthError, requireRole } from "@/lib/auth/rbac";
import { normalizeTeamRole, type TeamRole } from "@/lib/auth/permissions";
import { auth } from "@/lib/auth/server";
import { hasModule } from "@/lib/tenant/modules";
import { withTenantDb } from "@/lib/db/tenant";
import { syncBillableStaff } from "@/lib/billing/billable-staff";
import { sendEmail } from "@/lib/email/send";
import { TeamInviteEmail } from "@/emails/team-invite";
import { eq, and, desc, lt, asc, inArray } from "drizzle-orm";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import crypto from "crypto";
import { getBaseUrl } from "@/lib/utils";
import { trackEvent, identifyUser } from "@/lib/analytics/events";
import {
  addMembershipAndActivate,
  setActiveTenantForUser,
} from "@/lib/db/membership-helpers";
import { headers } from "next/headers";

const USER_MEMBERSHIPS_CACHE_TTL_SECONDS = 60;

function userMembershipsTag(userId: string): string {
  return `user:${userId}:memberships`;
}

/**
 * List all team members (users) for the current tenant.
 */
export async function listTeamMembers() {
  const { tenantSlug } = await requireRole("owner", "admin");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;

  const members = await publicDb
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.tenantSlug, slug))
    .orderBy(asc(user.name));

  return members;
}

const TEAM_INVITATIONS_UNAVAILABLE_MESSAGE =
  "Team invitations are unavailable until the latest database migration is applied.";

/**
 * Create a tenant stylist row for a team member when one does not already exist.
 */
async function insertStaffForTeamMember(params: {
  tenantSlug: string;
  userId: string;
  displayName: string;
  email: string;
  invitationRole: string;
}) {
  let inserted = false;
  await withTenantDb(
    params.tenantSlug,
    async (db, { staff }) => {
      const [existing] = await db
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.userId, params.userId))
        .limit(1);
      if (existing) return;
      await db.insert(staff).values({
        displayName: params.displayName,
        userId: params.userId,
        email: params.email.toLowerCase(),
        ...(params.invitationRole === "assistant" ? { role: "assistant" } : {}),
      });
      inserted = true;
    },
  );
  if (inserted) await syncBillableStaff(params.tenantSlug);
}

function isMissingTeamInvitationsTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "42P01" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.includes("team_invitations")
  );
}

/**
 * Send a team invitation email.
 * Only owners can invite new team members.
 */
export async function sendInvitation(data: {
  email: string;
  role: TeamRole;
}): Promise<{ success: true } | { success: false; error: string }> {
  const { userId, role: callerRole, tenantSlug } = await requireRole("owner", "admin");
    if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;
  try {

    // Only owners can invite other owners
    if (data.role === "owner" && callerRole !== "owner") {
      return { success: false, error: "Only owners can invite other owners" };
    }

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return { success: false, error: "Invalid email address" };
    }

    // Assistants need the assistant_tasks module
    if (data.role === "assistant" && !(await hasModule(slug, "assistant_tasks"))) {
      return {
        success: false,
        error: (await getT("errors", slug))("team.assistantsDisabled"),
      };
    }

    // Check for existing pending invitation for same email + tenant
    const [existingInvite] = await publicDb
      .select({ id: teamInvitations.id })
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.email, data.email.toLowerCase()),
          eq(teamInvitations.tenantSlug, slug),
          eq(teamInvitations.status, "pending"),
        ),
      )
      .limit(1);

    if (existingInvite) {
      return {
        success: false,
        error: "An invitation is already pending for this email",
      };
    }

    // Check if email already has a membership for this tenant
    const [existingMembership] = await publicDb
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(
        and(
          eq(user.email, data.email.toLowerCase()),
          eq(memberships.tenantSlug, slug),
        ),
      )
      .limit(1);

    if (existingMembership) {
      return {
        success: false,
        error: "A team member with this email already exists",
      };
    }

    // Generate invite token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create invitation record
    await publicDb.insert(teamInvitations).values({
      tenantSlug: slug,
      email: data.email.toLowerCase(),
      role: normalizeTeamRole(data.role),
      invitedBy: userId,
      token,
      expiresAt,
    });

    // Get inviter name and salon name for the email
    const [inviter] = await publicDb
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    const [tenant] = await publicDb
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    const [emailT, branding] = await Promise.all([
      getEmailT(slug, "emails"),
      getEmailBranding(slug),
    ]);
    const inviterName = inviter?.name ?? emailT("fallbacks.yourPlaceTeam");
    const salonName = tenant?.name ?? branding.salonName;
    const staffLabel = (await getTenantTerms(slug)).staff.one;

    // Build accept URL
    const acceptUrl = `${getBaseUrl()}/invite/${token}`;

    // Send invitation email
    await sendEmail({
      to: data.email.toLowerCase(),
      subject: emailT("team.subject", { business: salonName }),
      react: TeamInviteEmail({
        t: emailT,
        salonName,
        inviterName,
        roleLabel: teamRoleLabel(data.role, staffLabel),
        acceptUrl,
        logoUrl: branding.logoUrl,
        brandColor: branding.brandColor,
      }),
      salonName,
    });

    revalidatePath("/settings/team");
    trackEvent("team.invited", { role: normalizeTeamRole(data.role) }, { tenantSlug: slug });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (isMissingTeamInvitationsTableError(error)) {
      return {
        success: false,
        error: TEAM_INVITATIONS_UNAVAILABLE_MESSAGE,
      };
    }
    console.error("[Team] Failed to send invitation:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to send invitation",
    };
  }
}

/**
 * List all invitations for the current tenant.
 * Owners and admins can view.
 */
export async function listInvitations(): Promise<{
  invitations: Array<{
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
  }>;
  unavailable: boolean;
}> {
  const { tenantSlug } = await requireRole("owner", "admin");
  if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;

  try {
    // Mark expired invitations before listing
    await publicDb
      .update(teamInvitations)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(teamInvitations.tenantSlug, slug),
          eq(teamInvitations.status, "pending"),
          lt(teamInvitations.expiresAt, new Date()),
        ),
      );

    const invitations = await publicDb
      .select({
        id: teamInvitations.id,
        email: teamInvitations.email,
        role: teamInvitations.role,
        status: teamInvitations.status,
        expiresAt: teamInvitations.expiresAt,
        createdAt: teamInvitations.createdAt,
      })
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.tenantSlug, slug),
          inArray(teamInvitations.status, ["pending", "expired"]),
        ),
      )
      .orderBy(desc(teamInvitations.createdAt));

    return { invitations, unavailable: false };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (isMissingTeamInvitationsTableError(error)) {
      return { invitations: [], unavailable: true };
    }
    throw error;
  }
}

/**
 * Resend an expired invitation.
 * Deletes the expired record and creates a fresh one.
 */
export async function resendInvitation(
  invitationId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin");
    if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;
  try {

    // Find the expired invitation
    const [expired] = await publicDb
      .select({
        id: teamInvitations.id,
        email: teamInvitations.email,
        role: teamInvitations.role,
      })
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.id, invitationId),
          eq(teamInvitations.tenantSlug, slug),
          eq(teamInvitations.status, "expired"),
        ),
      )
      .limit(1);

    if (!expired) {
      return { success: false, error: "Invitation not found or not expired" };
    }

    // Delete the expired record
    await publicDb
      .delete(teamInvitations)
      .where(eq(teamInvitations.id, invitationId));

    // Create a fresh invitation via the existing flow
    return sendInvitation({
      email: expired.email,
      role: expired.role as TeamRole,
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (isMissingTeamInvitationsTableError(error)) {
      return { success: false, error: TEAM_INVITATIONS_UNAVAILABLE_MESSAGE };
    }
    return { success: false, error: "Failed to resend invitation" };
  }
}

/**
 * Revoke a pending invitation.
 * Owners and admins can revoke.
 */
export async function revokeInvitation(
  invitationId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const { tenantSlug } = await requireRole("owner", "admin");
    if (!tenantSlug) throw new AuthError("NO_TENANT", "No active salon");
  const slug = tenantSlug;
  try {

    const result = await publicDb
      .update(teamInvitations)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(
        and(
          eq(teamInvitations.id, invitationId),
          eq(teamInvitations.tenantSlug, slug),
          eq(teamInvitations.status, "pending"),
        ),
      )
      .returning({ id: teamInvitations.id });

    if (result.length === 0) {
      return {
        success: false,
        error: "Invitation not found or already processed",
      };
    }

    revalidatePath("/settings/team");
    trackEvent("team.invite_revoked", {}, { tenantSlug: slug });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (isMissingTeamInvitationsTableError(error)) {
      return {
        success: false,
        error: TEAM_INVITATIONS_UNAVAILABLE_MESSAGE,
      };
    }
    return { success: false, error: "Failed to revoke invitation" };
  }
}

/**
 * Look up an invitation by its token.
 * Public — no auth required (invitee doesn't have an account yet).
 */
export async function getInvitationByToken(token: string): Promise<{
  invitation: {
    id: string;
    email: string;
    role: string;
    tenantSlug: string;
  };
  salonName: string;
} | null> {
  const [invitation] = await publicDb
    .select({
      id: teamInvitations.id,
      email: teamInvitations.email,
      role: teamInvitations.role,
      tenantSlug: teamInvitations.tenantSlug,
      status: teamInvitations.status,
      expiresAt: teamInvitations.expiresAt,
    })
    .from(teamInvitations)
    .where(eq(teamInvitations.token, token))
    .limit(1);

  if (!invitation) return null;

  // Check if expired
  if (invitation.expiresAt < new Date()) {
    await publicDb
      .update(teamInvitations)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(teamInvitations.id, invitation.id));
    return null;
  }

  // Check if already used/revoked
  if (invitation.status !== "pending") return null;

  // Get salon name
  const [tenant] = await publicDb
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, invitation.tenantSlug))
    .limit(1);

  return {
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      tenantSlug: invitation.tenantSlug,
    },
    salonName: tenant?.name ?? invitation.tenantSlug,
  };
}

/**
 * Accept an invitation and create a new team member account.
 * Public — the invitee is creating their account.
 * If an account with this email already exists, returns `code: "EXISTING_ACCOUNT"` so the client can prompt sign-in + join flow.
 */
export async function acceptInvitation(
  token: string,
  userData: { name: string; email: string; password: string },
): Promise<
  | { success: true; tenantSlug: string }
  | {
      success: false;
      error: string;
      code?: "EXISTING_ACCOUNT";
    }
> {
  try {
    // Validate the invitation
    const result = await getInvitationByToken(token);
    if (!result) {
      return {
        success: false,
        error: "This invitation has expired or is no longer valid",
      };
    }

    const { invitation } = result;

    // Verify email matches (case-insensitive)
    if (userData.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return {
        success: false,
        error: "Email does not match the invitation",
      };
    }

    const [existingAccount] = await publicDb
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, userData.email.toLowerCase()))
      .limit(1);

    if (existingAccount) {
      return {
        success: false,
        error: (await getT("errors", invitation.tenantSlug))("team.existingAccount"),
        code: "EXISTING_ACCOUNT",
      };
    }

    // Create user account via Better Auth
    const newUser = await auth.api.signUpEmail({
      body: {
        name: userData.name,
        email: userData.email,
        password: userData.password,
      },
    });

    if (!newUser?.user?.id) {
      return { success: false, error: "Failed to create account" };
    }

    await addMembershipAndActivate(
      newUser.user.id,
      invitation.tenantSlug,
      // Invitations created before public migration 0026 may still carry 'stylist'.
      normalizeTeamRole(invitation.role),
    );
    revalidateTag(userMembershipsTag(newUser.user.id));

    await insertStaffForTeamMember({
      tenantSlug: invitation.tenantSlug,
      userId: newUser.user.id,
      displayName: userData.name,
      email: userData.email,
      invitationRole: invitation.role,
    });

    // Mark invitation as accepted
    await publicDb
      .update(teamInvitations)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(teamInvitations.id, invitation.id));

    identifyUser(newUser.user.id, {
      email: userData.email,
      name: userData.name,
      tenantSlug: invitation.tenantSlug,
      role: invitation.role,
    });
    trackEvent(
      "team.joined",
      { role: invitation.role },
      { tenantSlug: invitation.tenantSlug, userId: newUser.user.id },
    );
    return { success: true, tenantSlug: invitation.tenantSlug };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[Team] Failed to accept invitation:", error);
    if (
      error instanceof Error &&
      (error.message?.includes("UNIQUE") || error.message?.includes("unique"))
    ) {
      return {
        success: false,
        error: "An account with this email already exists",
        code: "EXISTING_ACCOUNT",
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to accept invitation",
    };
  }
}

/**
 * Accept an invitation for a user who already has an account (same email as the invite).
 * Requires an active session matching the invitation email. Switches active tenant to the new business.
 */
export async function joinBusinessFromInvitation(
  token: string,
): Promise<
  { success: true; tenantSlug: string } | { success: false; error: string }
> {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user?.id) {
      return { success: false, error: (await getT("errors"))("team.signInToJoin") };
    }

    const result = await getInvitationByToken(token);
    if (!result) {
      return {
        success: false,
        error: "This invitation has expired or is no longer valid",
      };
    }

    const { invitation } = result;
    const sessionEmail = session.user.email?.toLowerCase() ?? "";
    if (sessionEmail !== invitation.email.toLowerCase()) {
      return {
        success: false,
        error: "Sign in with the email address this invitation was sent to.",
      };
    }

    const [duplicate] = await publicDb
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, session.user.id),
          eq(memberships.tenantSlug, invitation.tenantSlug),
        ),
      )
      .limit(1);

    if (duplicate) {
      return {
        success: false,
        error: (await getT("errors", invitation.tenantSlug))("team.alreadyMember"),
      };
    }

    await addMembershipAndActivate(
      session.user.id,
      invitation.tenantSlug,
      // Invitations created before public migration 0026 may still carry 'stylist'.
      normalizeTeamRole(invitation.role),
    );
    revalidateTag(userMembershipsTag(session.user.id));

    const displayName = session.user.name?.trim() || invitation.email.split("@")[0];
    await insertStaffForTeamMember({
      tenantSlug: invitation.tenantSlug,
      userId: session.user.id,
      displayName,
      email: invitation.email,
      invitationRole: invitation.role,
    });

    await publicDb
      .update(teamInvitations)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(teamInvitations.id, invitation.id));

    identifyUser(session.user.id, {
      email: invitation.email,
      name: displayName,
      tenantSlug: invitation.tenantSlug,
      role: invitation.role,
    });
    trackEvent(
      "team.joined",
      { role: invitation.role },
      { tenantSlug: invitation.tenantSlug, userId: session.user.id },
    );
    return { success: true, tenantSlug: invitation.tenantSlug };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[Team] Failed to join from invitation:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : (await getT("errors"))("team.joinFailed"),
    };
  }
}

export type UserMembershipRow = {
  tenantSlug: string;
  role: string;
  salonName: string;
};

/**
 * All salons the current user belongs to (for the tenant switcher).
 */
export async function listUserMemberships(): Promise<{
  memberships: UserMembershipRow[];
  activeTenantSlug: string | null;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return { memberships: [], activeTenantSlug: null };
  }

  return unstable_cache(
    async () => {
      const [dbUser] = await publicDb
        .select({ tenantSlug: user.tenantSlug })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1);

      const rows = await publicDb
        .select({
          tenantSlug: memberships.tenantSlug,
          role: memberships.role,
          salonName: tenants.name,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.slug, memberships.tenantSlug))
        .where(eq(memberships.userId, session.user.id))
        .orderBy(asc(tenants.name));

      return {
        memberships: rows,
        activeTenantSlug: dbUser?.tenantSlug ?? null,
      };
    },
    ["user-memberships", session.user.id],
    {
      revalidate: USER_MEMBERSHIPS_CACHE_TTL_SECONDS,
      tags: [userMembershipsTag(session.user.id)],
    },
  )();
}

/**
 * Switch the active salon for the current user (updates denormalized user.role / user.tenant_slug).
 */
export async function switchActiveTenant(
  tenantSlug: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return { success: false, error: "Not signed in" };
    }

    const [row] = await publicDb
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, session.user.id),
          eq(memberships.tenantSlug, tenantSlug),
        ),
      )
      .limit(1);

    if (!row) {
      return {
        success: false,
        error: (await getT("errors", tenantSlug))("team.noAccess"),
      };
    }

    await setActiveTenantForUser(session.user.id, tenantSlug, row.role);
    revalidatePath("/", "layout");
    revalidateTag(userMembershipsTag(session.user.id));
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    console.error("[Team] switchActiveTenant:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : (await getT("errors"))("team.switchFailed"),
    };
  }
}
