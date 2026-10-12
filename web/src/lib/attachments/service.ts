import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getStorageProvider } from "@/lib/providers/storage";
import { signFileLink } from "@/lib/storage/file-links";
import { MAX_UPLOAD_BYTES, sniffMime, type AllowedMime } from "./sniff";

export type OwnerType = "request" | "appointment" | "project" | "form_response" | "client";
export type AttachmentKind = "reference" | "before" | "after" | "site" | "id_document" | "design";

export class AttachmentError extends Error {
  constructor(readonly code: "ATTACHMENT_TOO_LARGE" | "ATTACHMENT_TYPE") {
    super(code);
    this.name = "AttachmentError";
  }
}

const EXT: Record<AllowedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
};

/**
 * Stores a private file and records it. The type comes from the file's leading
 * bytes, never from what the browser claims. No URL is stored, only the key.
 */
export async function createAttachment(p: {
  slug: string;
  ownerType: OwnerType;
  ownerId: string | null;
  clientId: string | null;
  kind: AttachmentKind;
  file: File;
  uploadedBy: string;
  deleteAfter: Date | null;
}): Promise<{ id: string }> {
  const buf = Buffer.from(await p.file.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_UPLOAD_BYTES) throw new AttachmentError("ATTACHMENT_TOO_LARGE");
  const mime = sniffMime(buf);
  if (!mime) throw new AttachmentError("ATTACHMENT_TYPE");

  const id = randomUUID();
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const storage = getStorageProvider();
  const { key } = await storage.put({
    key: `t/${p.slug}/${p.ownerType}/${yyyy}/${mm}/${id}.${EXT[mime]}`,
    body: new Blob([new Uint8Array(buf)], { type: mime }),
    contentType: mime,
    visibility: "private",
  });

  try {
    await withTenantDb(p.slug, async (db, { attachments }) => {
      await db.insert(attachments).values({
        id,
        ownerType: p.ownerType,
        ownerId: p.ownerId,
        clientId: p.clientId,
        kind: p.kind,
        storageKey: key,
        mime,
        sizeBytes: buf.length,
        originalName: p.file.name ? p.file.name.slice(0, 200) : null,
        isPrivate: 1,
        uploadedBy: p.uploadedBy,
        deleteAfter: p.deleteAfter,
      });
    });
  } catch (err) {
    await storage.deleteByKey(key).catch(() => {});
    throw err;
  }
  return { id };
}

export type AttachmentView = {
  id: string;
  kind: string;
  mime: string;
  originalName: string | null;
  createdAt: Date;
  viewUrl: string;
};

export async function listAttachments(
  slug: string,
  ownerType: OwnerType,
  ownerId: string,
): Promise<AttachmentView[]> {
  const rows = await withTenantDb(slug, async (db, { attachments }) =>
    db
      .select({
        id: attachments.id,
        kind: attachments.kind,
        mime: attachments.mime,
        originalName: attachments.originalName,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(
        and(
          eq(attachments.ownerType, ownerType),
          eq(attachments.ownerId, ownerId),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(asc(attachments.createdAt)),
  );
  return rows.map((r) => ({ ...r, viewUrl: signFileLink(slug, r.id) }));
}

/** Removes the stored file first, then marks the row deleted. */
export async function softDeleteAttachment(slug: string, id: string): Promise<void> {
  const row = await withTenantDb(slug, async (db, { attachments }) => {
    const [r] = await db
      .select({ storageKey: attachments.storageKey })
      .from(attachments)
      .where(and(eq(attachments.id, id), isNull(attachments.deletedAt)))
      .limit(1);
    return r ?? null;
  });
  if (!row) return;
  await getStorageProvider().deleteByKey(row.storageKey);
  await withTenantDb(slug, async (db, { attachments }) => {
    await db.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, id));
  });
}
