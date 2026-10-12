"use server";

import { z } from "zod";
import { requireStaff } from "@/lib/auth/rbac";
import {
  findAppointmentPhoto,
  listAppointmentPhotoRecords,
  markAppointmentPhotoDeleted,
} from "@/lib/photos/appointment-photos";
import { canDeleteAppointmentPhoto, type AppointmentPhotoKind } from "@/lib/photos/rules";
import { signFileLink } from "@/lib/storage/file-links";
import { getStorageProvider } from "@/lib/providers/storage";
import { assertModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";

const TEAM = ["owner", "admin", "provider", "assistant"] as const;
const uuidSchema = z.string().uuid();

export type AppointmentPhotoView = {
  id: string;
  kind: AppointmentPhotoKind;
  caption: string | null;
  url: string;
  createdAt: string;
  canDelete: boolean;
};

export async function listAppointmentPhotos(appointmentId: string): Promise<AppointmentPhotoView[]> {
  const auth = await requireStaff(...TEAM);
  await assertModule(auth.tenantSlug, "attachments");
  if (!uuidSchema.safeParse(appointmentId).success) return [];
  const rows = await listAppointmentPhotoRecords(auth.tenantSlug, appointmentId);
  const now = new Date();
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    caption: row.caption,
    url: signFileLink(auth.tenantSlug, row.id, 600),
    createdAt: row.createdAt.toISOString(),
    canDelete: canDeleteAppointmentPhoto({
      role: auth.role,
      userId: auth.userId,
      uploadedBy: row.uploadedBy,
      createdAt: row.createdAt,
      now,
    }),
  }));
}

export async function deleteAppointmentPhoto(input: {
  attachmentId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireStaff(...TEAM);
  await assertModule(auth.tenantSlug, "attachments");
  const t = await getT("appointmentWork", auth.tenantSlug);
  if (!uuidSchema.safeParse(input.attachmentId).success) {
    return { ok: false, error: t("photos.notFound") };
  }
  const photo = await findAppointmentPhoto(auth.tenantSlug, input.attachmentId);
  if (!photo) return { ok: false, error: t("photos.notFound") };
  const allowed = canDeleteAppointmentPhoto({
    role: auth.role,
    userId: auth.userId,
    uploadedBy: photo.uploadedBy,
    createdAt: photo.createdAt,
    now: new Date(),
  });
  if (!allowed) return { ok: false, error: t("photos.notAllowed") };
  await getStorageProvider().deleteByKey(photo.storageKey);
  await markAppointmentPhotoDeleted(auth.tenantSlug, photo.id);
  return { ok: true };
}
