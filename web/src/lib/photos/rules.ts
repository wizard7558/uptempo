export const APPOINTMENT_PHOTO_KINDS = ["before", "after", "site"] as const;

export type AppointmentPhotoKind = (typeof APPOINTMENT_PHOTO_KINDS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export function canDeleteAppointmentPhoto(actor: {
  role: "owner" | "admin" | "provider" | "assistant";
  userId: string;
  uploadedBy: string;
  createdAt: Date;
  now: Date;
}): boolean {
  if (actor.role === "owner" || actor.role === "admin") return true;
  if (actor.userId !== actor.uploadedBy) return false;
  return actor.now.getTime() - actor.createdAt.getTime() <= DAY_MS;
}
