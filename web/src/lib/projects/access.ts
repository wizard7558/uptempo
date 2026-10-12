/**
 * Who may change a project. Owners and admins may change any. A provider may
 * change only a project assigned to them.
 */
export function canEditProject(
  role: string,
  actorStaffId: string | null,
  projectStaffId: string | null,
): boolean {
  if (role !== "provider") return true;
  return actorStaffId != null && projectStaffId === actorStaffId;
}
