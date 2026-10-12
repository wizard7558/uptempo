export type TeamRole = "owner" | "admin" | "provider" | "assistant";

/** Role value written before public migration 0026; accepted until the Phase 2 cleanup. */
export const LEGACY_PROVIDER_ROLE = "stylist";

export function normalizeTeamRole(role: string): string {
  return role === LEGACY_PROVIDER_ROLE ? "provider" : role;
}

export const PERMISSIONS = {
  invite_team: ["owner"],
  manage_billing: ["owner"],
  manage_settings: ["owner", "admin"],
  manage_services: ["owner", "admin"],
  manage_staff: ["owner", "admin"],
  view_revenue: ["owner", "admin"],
  manage_clients: ["owner", "admin", "provider"],
  manage_schedule: ["owner", "admin", "provider", "assistant"],
  view_own_schedule: ["owner", "admin", "provider", "assistant"],
} as const satisfies Record<string, readonly TeamRole[]>;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  const allowed = PERMISSIONS[permission];
  return (allowed as readonly string[]).includes(normalizeTeamRole(role));
}

/**
 * Throw if the role lacks the specified permission.
 */
export function requirePermission(
  role: string,
  permission: Permission,
): void {
  if (!hasPermission(role, permission)) {
    throw new Error(`Role "${role}" lacks permission "${permission}"`);
  }
}
