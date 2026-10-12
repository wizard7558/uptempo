"use server";

import { and, count, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenantDb } from "@/lib/db/tenant";
import { getTenantSlug } from "@/lib/tenant/context";
import { getTenantBySlug } from "@/lib/tenant/registry";
import { assertModule, hasModule, ModuleDisabledError } from "@/lib/tenant/modules";
import { getBookingSession } from "@/lib/booking/session-cookie";
import { getT } from "@/lib/terms/server";
import { getVertical } from "@/lib/verticals";
import { trackEvent } from "@/lib/analytics/events";
import {
  AttachmentError,
  createAttachment,
  softDeleteAttachment,
} from "@/lib/attachments/service";
import { buildAnswersSchema, resolveRequestFields } from "@/lib/requests/fields";
import { notifyOwnerOfRequest } from "@/lib/requests/notify-owner";
import { requestsOpen } from "@/lib/requests/books";
import { addressInputSchema, insertAddressRow, judgeAddress, type AddressInput } from "@/lib/on-site/addresses";

const MAX_ORPHAN_UPLOADS_PER_HOUR = 10;
const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;

type Fail = { success: false; error: string };

class PhotoMissingError extends Error {}

/** Resolves the tenant, the module gate and the signed-in client, or a plain-language failure. */
async function gate(): Promise<
  | { ok: true; slug: string; clientId: string; t: Awaited<ReturnType<typeof getT>> }
  | { ok: false; error: string }
> {
  const slug = await getTenantSlug();
  const t = await getT("requests", slug);
  try {
    await assertModule(slug, "requests");
  } catch (err) {
    if (err instanceof ModuleDisabledError) return { ok: false, error: err.message };
    throw err;
  }
  const clientId = await getBookingSession();
  if (!clientId) return { ok: false, error: t("signInFirst") };
  return { ok: true, slug, clientId, t };
}

export async function uploadRequestPhoto(
  form: FormData,
): Promise<{ success: true; id: string; name: string } | Fail> {
  const sessionClientId = await getBookingSession();
  const g = await gate();
  if (!sessionClientId || !g.ok || g.clientId !== sessionClientId) {
    return { success: false, error: g.ok ? "Sign in first" : g.error };
  }
  const { slug, clientId, t } = g;

  const file = form.get("file");
  if (!(file instanceof File)) return { success: false, error: t("uploadFailed") };

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ n }] = await withTenantDb(slug, async (db, { attachments }) =>
    db
      .select({ n: count() })
      .from(attachments)
      .where(
        and(
          eq(attachments.clientId, clientId),
          isNull(attachments.ownerId),
          gt(attachments.createdAt, hourAgo),
        ),
      ),
  );
  if (n >= MAX_ORPHAN_UPLOADS_PER_HOUR) return { success: false, error: t("tooManyUploads") };

  try {
    const { id } = await createAttachment({
      slug,
      ownerType: "request",
      ownerId: null,
      clientId,
      kind: "reference",
      file,
      uploadedBy: `client:${clientId}`,
      deleteAfter: new Date(Date.now() + ORPHAN_TTL_MS),
    });
    return { success: true, id, name: file.name };
  } catch (err) {
    if (err instanceof AttachmentError) return { success: false, error: t("uploadFailed") };
    console.error("[requests] photo upload failed:", err);
    return { success: false, error: t("uploadFailed") };
  }
}

/** Only the client's own photo that no request has claimed yet can be removed. */
export async function removeRequestPhoto(id: string): Promise<{ success: boolean }> {
  const sessionClientId = await getBookingSession();
  if (!sessionClientId) return { success: false };
  const g = await gate();
  if (!g.ok || g.clientId !== sessionClientId) return { success: false };
  const { slug, clientId } = g;
  const mine = await withTenantDb(slug, async (db, { attachments }) => {
    const [row] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.clientId, clientId),
          isNull(attachments.ownerId),
          isNull(attachments.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  });
  if (!mine) return { success: false };
  await softDeleteAttachment(slug, id);
  return { success: true };
}

const windowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).max(7),
  parts: z.array(z.enum(["morning", "afternoon", "evening"])).max(3),
});

const submitSchema = z.object({
  serviceId: z.uuid().nullable(),
  staffId: z.uuid().nullable(),
  answers: z.record(z.string(), z.unknown()),
  preferredWindows: z.array(windowSchema).max(7),
  attachmentIds: z.array(z.uuid()).max(50),
});

export type SubmitBookingRequestInput = z.input<typeof submitSchema>;

export async function submitBookingRequest(
  input: SubmitBookingRequestInput,
): Promise<{ success: true; id: string } | Fail> {
  const sessionClientId = await getBookingSession();
  const g = await gate();
  if (!sessionClientId || !g.ok || g.clientId !== sessionClientId) {
    return { success: false, error: g.ok ? "Sign in first" : g.error };
  }
  const { slug, clientId, t } = g;

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: t("invalid") };
  const { serviceId, staffId, preferredWindows } = parsed.data;
  const attachmentIds = [...new Set(parsed.data.attachmentIds)];

  if (!(await requestsOpen(slug, staffId))) return { success: false, error: t("booksClosed") };

  const tenant = await getTenantBySlug(slug);
  const defs = resolveRequestFields(getVertical(tenant?.industry).requestFields);
  const answers = buildAnswersSchema(defs).safeParse(parsed.data.answers);
  if (!answers.success) return { success: false, error: t("required") };

  const maxPhotos = defs.reduce((sum, d) => sum + (d.kind === "photos" ? (d.maxPhotos ?? 0) : 0), 0);
  if (attachmentIds.length > maxPhotos) return { success: false, error: t("invalid") };

  // On-site businesses only take requests from inside the places they travel to.
  let address: { input: AddressInput; point: Awaited<ReturnType<typeof judgeAddress>>["point"] } | null = null;
  const rawAddress = answers.data.address;
  if (rawAddress !== undefined) {
    const addr = addressInputSchema.safeParse(rawAddress);
    if (!addr.success) return { success: false, error: t("required") };
    const verdict = await judgeAddress(slug, addr.data.postalCode, staffId);
    if ((await hasModule(slug, "on_site")) && verdict.result === "out_of_area") {
      return { success: false, error: t("outOfArea", { zip: verdict.zip }) };
    }
    address = { input: addr.data, point: verdict.point };
  }

  try {
    const created = await withTenantDb(slug, async (db, tbl) => {
      if (serviceId) {
        const [svc] = await db
          .select({ id: tbl.services.id })
          .from(tbl.services)
          .where(
            and(
              eq(tbl.services.id, serviceId),
              eq(tbl.services.isActive, 1),
              eq(tbl.services.onlineBookable, 1),
            ),
          )
          .limit(1);
        if (!svc) return { ok: false, error: t("invalid") } as const;
      }
      if (staffId) {
        const [member] = await db
          .select({ id: tbl.staff.id })
          .from(tbl.staff)
          .where(and(eq(tbl.staff.id, staffId), eq(tbl.staff.isActive, 1)))
          .limit(1);
        if (!member) return { ok: false, error: t("invalid") } as const;
      }
      const [client] = await db
        .select({ name: tbl.clients.name })
        .from(tbl.clients)
        .where(eq(tbl.clients.id, clientId))
        .limit(1);

      const id = await db.transaction(async (tx) => {
        const addressId = address
          ? await insertAddressRow(tx, tbl.clientAddresses, clientId, address.input, address.point)
          : null;
        const [req] = await tx
          .insert(tbl.bookingRequests)
          .values({
            clientId,
            serviceId,
            staffId,
            kind: "quote",
            status: "new",
            answers: answers.data,
            preferredWindows,
            addressId,
          })
          .returning({ id: tbl.bookingRequests.id });
        if (attachmentIds.length > 0) {
          const claimed = await tx
            .update(tbl.attachments)
            .set({ ownerId: req.id, deleteAfter: null })
            .where(
              and(
                inArray(tbl.attachments.id, attachmentIds),
                eq(tbl.attachments.ownerType, "request"),
                isNull(tbl.attachments.ownerId),
                eq(tbl.attachments.clientId, clientId),
                isNull(tbl.attachments.deletedAt),
              ),
            )
            .returning({ id: tbl.attachments.id });
          if (claimed.length !== attachmentIds.length) throw new PhotoMissingError();
        }
        return req.id;
      });
      return { ok: true, id, clientName: client?.name ?? "" } as const;
    });
    if (!created.ok) return { success: false, error: created.error };

    await afterSubmit(slug, created.id, created.clientName, t);
    return { success: true, id: created.id };
  } catch (err) {
    if (err instanceof PhotoMissingError) return { success: false, error: t("photoMissing") };
    throw err;
  }
}

/** Analytics, in-app alert and owner email. None of it may fail the client's submit. */
async function afterSubmit(
  slug: string,
  requestId: string,
  clientName: string,
  t: Awaited<ReturnType<typeof getT>>,
): Promise<void> {
  trackEvent("request.submitted", { requestId }, { tenantSlug: slug });
  {
    try {
      await withTenantDb(slug, async (db, { alerts }) => {
        await db
          .insert(alerts)
          .values({
            type: "request_new",
            severity: "info",
            title: t("alertTitle", { client: clientName }),
            body: t("alertBody"),
            data: { requestId },
            dedupeKey: `request_new:${requestId}`,
          })
          .onConflictDoNothing({ target: alerts.dedupeKey });
      });
    } catch (err) {
      console.error("[requests] alert failed:", err);
    }
    try {
      await notifyOwnerOfRequest({ slug, requestId, clientName });
    } catch (err) {
      console.error("[requests] owner email failed:", err);
    }
  }
}
