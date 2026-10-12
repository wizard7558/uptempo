"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  addChecklistItem,
  removeChecklistItem,
  setChecklistItemDone,
  type AppointmentChecklistItemView,
} from "@/actions/checklists";
import { deleteAppointmentPhoto, type AppointmentPhotoView } from "@/actions/appointment-photos";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { CustomFieldsCard } from "@/components/custom-fields/custom-fields-card";
import type { FieldDef } from "@/lib/custom-fields/values";
import { compressImage } from "@/lib/images/compress";
import type { AppointmentPhotoKind } from "@/lib/photos/rules";
import { useT } from "@/lib/terms/client";

const KIND_KEY = {
  before: "photos.before",
  after: "photos.after",
  site: "photos.other",
} as const;

function photoClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function PhotoPick({
  kind,
  label,
  variant,
  disabled,
  onPick,
}: {
  kind: AppointmentPhotoKind;
  label: string;
  variant: "default" | "outline";
  disabled: boolean;
  onPick: (kind: AppointmentPhotoKind, file: File) => void;
}) {
  return (
    <Button asChild variant={variant} className={`h-12 w-full${disabled ? " pointer-events-none opacity-50" : ""}`}>
      <label>
        {label}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onPick(kind, file);
          }}
        />
      </label>
    </Button>
  );
}

export function AppointmentWorkClient({
  appointmentId,
  clientName,
  whenLabel,
  serviceNames,
  staffName,
  statusLabel,
  timeZone,
  photosOn,
  checklist,
  photos,
  fieldDefinitions,
  attributes,
}: {
  appointmentId: string;
  clientName: string;
  whenLabel: string;
  serviceNames: string;
  staffName: string;
  statusLabel: string;
  timeZone: string;
  photosOn: boolean;
  checklist: AppointmentChecklistItemView[];
  photos: AppointmentPhotoView[];
  fieldDefinitions: FieldDef[];
  attributes: Record<string, unknown>;
}) {
  const t = useT("appointmentWork");
  const router = useRouter();
  const [items, setItems] = useState(checklist);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState<AppointmentPhotoKind | null>(null);
  const done = items.filter((item) => item.doneAt).length;

  function toggle(item: AppointmentChecklistItemView, next: boolean) {
    const previous = items;
    setItems((current) =>
      current.map((row) =>
        row.id === item.id ? { ...row, doneAt: next ? new Date().toISOString() : null } : row,
      ),
    );
    startTransition(async () => {
      try {
        const result = await setChecklistItemDone({ itemId: item.id, done: next });
        if (!result.ok) {
          setItems(previous);
          toast.error(result.error);
        }
      } catch {
        setItems(previous);
        toast.error(t("errors.saveFailed"));
      }
    });
  }

  function addItem() {
    const label = draft;
    startTransition(async () => {
      try {
        const result = await addChecklistItem({ appointmentId, label });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setItems((current) => [...current, result.item]);
        setDraft("");
      } catch {
        toast.error(t("errors.saveFailed"));
      }
    });
  }

  function removeItem(itemId: string) {
    const previous = items;
    setItems((current) => current.filter((row) => row.id !== itemId));
    startTransition(async () => {
      try {
        const result = await removeChecklistItem({ itemId });
        if (!result.ok) {
          setItems(previous);
          toast.error(result.error);
        }
      } catch {
        setItems(previous);
        toast.error(t("errors.saveFailed"));
      }
    });
  }

  async function upload(kind: AppointmentPhotoKind, file: File) {
    setUploading(kind);
    try {
      const compressed = await compressImage(file);
      const body = new FormData();
      body.set("kind", kind);
      body.set(
        "file",
        compressed instanceof File
          ? compressed
          : new File([compressed], "photo.jpg", { type: "image/jpeg" }),
      );
      const res = await fetch(`/api/appointments/${appointmentId}/photos`, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        toast.error(
          res.status === 413
            ? t("photos.tooBig")
            : res.status === 415
              ? t("photos.type")
              : t("photos.failed"),
        );
        return;
      }
      toast.success(t("photos.uploaded"));
      router.refresh();
    } catch {
      toast.error(t("photos.failed"));
    } finally {
      setUploading(null);
    }
  }

  async function removePhoto(photo: AppointmentPhotoView) {
    if (!window.confirm(t("photos.deleteConfirm"))) return;
    try {
      const result = await deleteAppointmentPhoto({ attachmentId: photo.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    } catch {
      toast.error(t("photos.deleteFailed"));
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-6">
      <Link href="/schedule" className="text-sm text-muted-foreground">
        {t("page.back")}
      </Link>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{clientName}</h1>
        <p>{whenLabel}</p>
        <p>{serviceNames}</p>
        <p>{staffName}</p>
        <p>{statusLabel}</p>
      </div>

      {fieldDefinitions.length > 0 ? (
        <CustomFieldsCard
          entity="appointment"
          ownerId={appointmentId}
          definitions={fieldDefinitions}
          values={attributes}
          canEdit
        />
      ) : null}

      {photosOn ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t("checklist.title")}</h2>
          <p>{t("checklist.progress", { done, total: items.length })}</p>
          {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("checklist.empty")}</p> : null}
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.id} className="flex min-h-14 items-center gap-2">
                <label className="flex min-h-14 flex-1 items-center gap-3">
                  <Checkbox
                    className="size-6"
                    checked={item.doneAt != null}
                    onCheckedChange={(value) => toggle(item, value === true)}
                  />
                  <span className={item.doneAt ? "line-through" : undefined}>{item.label}</span>
                </label>
                {item.sourceKey == null ? (
                  <Button type="button" variant="ghost" onClick={() => removeItem(item.id)}>
                    {t("checklist.remove")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={draft}
              placeholder={t("checklist.addPlaceholder")}
              aria-label={t("checklist.addPlaceholder")}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="button" onClick={addItem} disabled={pending}>
              {t("checklist.add")}
            </Button>
          </div>
        </section>
      ) : null}

      {photosOn ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">{t("photos.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("photos.private")}</p>
          <div className="flex flex-col gap-3">
            <PhotoPick
              kind="before"
              label={t("photos.addBefore")}
              variant="default"
              disabled={uploading != null}
              onPick={upload}
            />
            <PhotoPick
              kind="after"
              label={t("photos.addAfter")}
              variant="default"
              disabled={uploading != null}
              onPick={upload}
            />
            <PhotoPick
              kind="site"
              label={t("photos.addOther")}
              variant="outline"
              disabled={uploading != null}
              onPick={upload}
            />
          </div>
          {uploading ? <p>{t("photos.uploading")}</p> : null}
          {photos.length === 0 ? <p className="text-sm text-muted-foreground">{t("photos.empty")}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            {photos.map((photo) => {
              const kindLabel = t(KIND_KEY[photo.kind]);
              return (
                <figure key={photo.id} className="space-y-2">
                  <img
                    src={photo.url}
                    alt={`${kindLabel} ${photoClock(photo.createdAt, timeZone)}`}
                    className="aspect-square w-full rounded-lg object-cover"
                  />
                  <figcaption>{kindLabel}</figcaption>
                  {photo.canDelete ? (
                    <Button type="button" variant="ghost" onClick={() => removePhoto(photo)}>
                      {t("photos.delete")}
                    </Button>
                  ) : null}
                </figure>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
