import { hasPermission } from "@/lib/auth/permissions";

export function landingPathForRole(role: string | null | undefined): string {
  if (role && hasPermission(role, "manage_schedule")) return "/schedule";
  return "/schedule";
}
