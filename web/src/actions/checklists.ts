"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/rbac";
import {
  addChecklistItem as insertChecklistItem,
  listAppointmentChecklist,
  listChecklistTemplates as loadTemplates,
  removeChecklistItem as deleteChecklistItem,
  saveChecklistTemplate as upsertChecklistTemplate,
  setChecklistItemDone as markChecklistItemDone,
  type AppointmentChecklistItem,
  type ChecklistTemplateItem,
  type ChecklistTemplateRow,
} from "@/lib/checklists/service";
import { assertModule } from "@/lib/tenant/modules";
import { getT } from "@/lib/terms/server";

const ADMIN = ["owner", "admin"] as const;
const TEAM = ["owner", "admin", "provider", "assistant"] as const;

const uuidSchema = z.string().uuid();

type Failure = { ok: false; error: string };

function toClientItem(row: AppointmentChecklistItem) {
  return {
    id: row.id,
    label: row.label,
    sortOrder: row.sortOrder,
    sourceKey: row.sourceKey,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    doneBy: row.doneBy,
  };
}

export type AppointmentChecklistItemView = ReturnType<typeof toClientItem>;

export async function listChecklistTemplates(): Promise<ChecklistTemplateRow[]> {
  const auth = await requireStaff(...ADMIN);
  await assertModule(auth.tenantSlug, "attachments");
  return loadTemplates(auth.tenantSlug);
}

export async function saveChecklistTemplate(input: {
  serviceId: string;
  items: { id?: string; label: string }[];
}): Promise<{ ok: true; items: ChecklistTemplateItem[] } | Failure> {
  const auth = await requireStaff(...ADMIN);
  await assertModule(auth.tenantSlug, "attachments");
  const t = await getT("appointmentWork", auth.tenantSlug);
  if (!uuidSchema.safeParse(input.serviceId).success) {
    return { ok: false, error: t("errors.notFound") };
  }
  const saved = await upsertChecklistTemplate(auth.tenantSlug, input.serviceId, input.items);
  if (!saved.ok) {
    const key =
      saved.error === "tooMany"
        ? "settings.tooMany"
        : saved.error === "label"
          ? "settings.label"
          : "errors.notFound";
    return { ok: false, error: t(key) };
  }
  revalidatePath("/settings/checklists");
  return saved;
}

export async function getAppointmentChecklist(
  appointmentId: string,
): Promise<AppointmentChecklistItemView[]> {
  const auth = await requireStaff(...TEAM);
  await assertModule(auth.tenantSlug, "attachments");
  if (!uuidSchema.safeParse(appointmentId).success) return [];
  const rows = await listAppointmentChecklist(auth.tenantSlug, appointmentId);
  return rows.map(toClientItem);
}

export async function setChecklistItemDone(input: {
  itemId: string;
  done: boolean;
}): Promise<{ ok: true } | Failure> {
  const auth = await requireStaff(...TEAM);
  await assertModule(auth.tenantSlug, "attachments");
  const t = await getT("appointmentWork", auth.tenantSlug);
  if (!uuidSchema.safeParse(input.itemId).success || typeof input.done !== "boolean") {
    return { ok: false, error: t("errors.notFound") };
  }
  const updated = await markChecklistItemDone(
    auth.tenantSlug,
    input.itemId,
    input.done,
    auth.userId,
  );
  if (!updated) return { ok: false, error: t("errors.notFound") };
  return { ok: true };
}

export async function addChecklistItem(input: {
  appointmentId: string;
  label: string;
}): Promise<{ ok: true; item: AppointmentChecklistItemView } | Failure> {
  const auth = await requireStaff(...TEAM);
  await assertModule(auth.tenantSlug, "attachments");
  const t = await getT("appointmentWork", auth.tenantSlug);
  if (!uuidSchema.safeParse(input.appointmentId).success) {
    return { ok: false, error: t("errors.notFound") };
  }
  const added = await insertChecklistItem(auth.tenantSlug, input.appointmentId, input.label);
  if (!added.ok) return { ok: false, error: t("settings.label") };
  return { ok: true, item: toClientItem(added.item) };
}

export async function removeChecklistItem(input: {
  itemId: string;
}): Promise<{ ok: true } | Failure> {
  const auth = await requireStaff(...TEAM);
  await assertModule(auth.tenantSlug, "attachments");
  const t = await getT("appointmentWork", auth.tenantSlug);
  if (!uuidSchema.safeParse(input.itemId).success) {
    return { ok: false, error: t("errors.notFound") };
  }
  const removed = await deleteChecklistItem(auth.tenantSlug, input.itemId);
  if (!removed) return { ok: false, error: t("errors.notFound") };
  return { ok: true };
}
