import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { APPOINTMENT_PHOTO_KINDS, type AppointmentPhotoKind } from "./rules";

export type AppointmentPhotoRecord = {
  id: string;
  kind: AppointmentPhotoKind;
  caption: string | null;
  storageKey: string;
  uploadedBy: string;
  createdAt: Date;
};

function isPhotoKind(kind: string): kind is AppointmentPhotoKind {
  return (APPOINTMENT_PHOTO_KINDS as readonly string[]).includes(kind);
}

export async function appointmentClientId(
  slug: string,
  appointmentId: string,
): Promise<string | null> {
  return withTenantDb(slug, async (db, { appointments }) => {
    const [row] = await db
      .select({ clientId: appointments.clientId })
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1);
    return row?.clientId ?? null;
  });
}

export async function listAppointmentPhotoRecords(
  slug: string,
  appointmentId: string,
): Promise<AppointmentPhotoRecord[]> {
  const rows = await withTenantDb(slug, async (db, { attachments }) =>
    db
      .select({
        id: attachments.id,
        kind: attachments.kind,
        caption: attachments.caption,
        storageKey: attachments.storageKey,
        uploadedBy: attachments.uploadedBy,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.ownerType, "appointment"),
          eq(attachments.ownerId, appointmentId),
          inArray(attachments.kind, [...APPOINTMENT_PHOTO_KINDS]),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(desc(attachments.createdAt)),
  );
  return rows.flatMap((row) =>
    isPhotoKind(row.kind)
      ? [
          {
            id: row.id,
            kind: row.kind,
            caption: row.caption,
            storageKey: row.storageKey,
            uploadedBy: row.uploadedBy,
            createdAt: row.createdAt,
          },
        ]
      : [],
  );
}

export async function findAppointmentPhoto(
  slug: string,
  attachmentId: string,
): Promise<AppointmentPhotoRecord | null> {
  const row = await withTenantDb(slug, async (db, { attachments }) => {
    const [found] = await db
      .select({
        id: attachments.id,
        kind: attachments.kind,
        caption: attachments.caption,
        storageKey: attachments.storageKey,
        uploadedBy: attachments.uploadedBy,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, attachmentId),
          eq(attachments.ownerType, "appointment"),
          inArray(attachments.kind, [...APPOINTMENT_PHOTO_KINDS]),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1);
    return found ?? null;
  });
  if (!row || !isPhotoKind(row.kind)) return null;
  return {
    id: row.id,
    kind: row.kind,
    caption: row.caption,
    storageKey: row.storageKey,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  };
}

/** The file is removed first. The row stays, with deleted_at set, so lists and the purge cron skip it. */
export async function markAppointmentPhotoDeleted(slug: string, attachmentId: string): Promise<void> {
  await withTenantDb(slug, async (db, { attachments }) => {
    await db
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)));
  });
}
