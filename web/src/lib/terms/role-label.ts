import { normalizeTeamRole } from "@/lib/auth/permissions";

/**
 * Human-readable team role for invites and emails. The provider role (and the
 * legacy "stylist" value) is shown as the tenant's staff word; other roles are
 * capitalized ("admin" -> "Admin").
 */
export function teamRoleLabel(role: string, staffLabel: string): string {
  const normalized = normalizeTeamRole(role);
  if (normalized === "provider") return staffLabel;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
