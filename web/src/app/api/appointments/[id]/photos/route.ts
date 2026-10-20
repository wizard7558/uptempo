import { NextResponse } from "next/server";
import { z } from "zod";
import { createAttachment, AttachmentError } from "@/lib/attachments/service";
import { requireRole } from "@/lib/auth/rbac";
import { appointmentClientId } from "@/lib/photos/appointment-photos";
import { APPOINTMENT_PHOTO_KINDS, type AppointmentPhotoKind } from "@/lib/photos/rules";
import { ALLOWED_IMAGE_TYPES } from "@/lib/storage/image-blob-upload";
import { assertModule, ModuleDisabledError } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";

export const runtime = "nodejs";

const TEAM = ["owner", "admin", "provider", "assistant"] as const;
const MAX_BYTES = 4_000_000;
const uuidSchema = z.string().uuid();

function isPhotoKind(kind: string): kind is AppointmentPhotoKind {
  return (APPOINTMENT_PHOTO_KINDS as readonly string[]).includes(kind);
}

function isAllowedImageType(mime: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime);
}

/**
 * Staff upload a before, after, or other photo for one appointment.
 * createAttachment sniffs the bytes and stores a private file. This route
 * only refuses a file that is too large or not an image type we accept.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(...TEAM);
  if (!auth.tenantSlug) {
    return NextResponse.json({ error: "Sign in to a business first." }, { status: 401 });
  }
  const slug = auth.tenantSlug;
  try {
    await assertModule(slug, "attachments");
  } catch (error) {
    if (error instanceof ModuleDisabledError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const t = await getT("appointmentWork", slug);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: t("photos.failed") }, { status: 404 });
  }

  const form = await request.formData();
  const kindValue = form.get("kind");
  const file = form.get("file");
  const kind = typeof kindValue === "string" ? kindValue : "";
  if (!isPhotoKind(kind) || !(file instanceof File)) {
    return NextResponse.json({ error: t("photos.type") }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: t("photos.tooBig") }, { status: 413 });
  }
  if (!isAllowedImageType(file.type)) {
    return NextResponse.json({ error: t("photos.type") }, { status: 415 });
  }

  const clientId = await appointmentClientId(slug, id);
  if (!clientId) {
    return NextResponse.json({ error: t("photos.failed") }, { status: 404 });
  }

  try {
    const created = await createAttachment({
      slug,
      ownerType: "appointment",
      ownerId: id,
      clientId,
      kind,
      file,
      uploadedBy: auth.userId,
      deleteAfter: null,
    });
    return NextResponse.json({ id: created.id });
  } catch (error) {
    if (error instanceof AttachmentError) {
      const status = error.code === "ATTACHMENT_TOO_LARGE" ? 413 : 415;
      const message = error.code === "ATTACHMENT_TOO_LARGE" ? t("photos.tooBig") : t("photos.type");
      return NextResponse.json({ error: message }, { status });
    }
    throw error;
  }
}
