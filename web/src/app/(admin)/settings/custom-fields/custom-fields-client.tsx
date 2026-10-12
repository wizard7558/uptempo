"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCustomFieldDefinition,
  moveCustomFieldDefinition,
  updateCustomFieldDefinition,
} from "@/actions/custom-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FieldDef, FieldEntity, FieldType } from "@/lib/custom-fields/values";
import { FIELD_TYPES } from "@/lib/custom-fields/values";
import { useT } from "@/lib/terms/client";

type Section = {
  entity: FieldEntity;
  title: string;
  fields: FieldDef[];
};

type Draft = {
  entity: FieldEntity;
  id?: string;
  label: string;
  type: FieldType;
  options: string;
  showOnCard: boolean;
  clientEditable: boolean;
};

export function CustomFieldsClient({ sections }: { sections: Section[] }) {
  const t = useT("customFields");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function refresh() {
    setSaved(true);
    router.refresh();
  }

  function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setError(result.error ?? "");
        return;
      }
      setDraft(null);
      refresh();
    });
  }

  function openCreate(entity: FieldEntity) {
    setError(null);
    setDraft({
      entity,
      label: "",
      type: "text",
      options: "",
      showOnCard: true,
      clientEditable: false,
    });
  }

  function openEdit(field: FieldDef) {
    setError(null);
    setDraft({
      entity: field.entity,
      id: field.id,
      label: field.label,
      type: field.type,
      options: field.options.map((option) => option.label).join("\n"),
      showOnCard: field.showOnCard,
      clientEditable: field.clientEditable,
    });
  }

  function saveDraft() {
    if (!draft) return;
    const options = draft.options.split("\n");
    run(async () => {
      if (draft.id) {
        return updateCustomFieldDefinition({
          id: draft.id,
          label: draft.label,
          options,
          showOnCard: draft.showOnCard,
          clientEditable: draft.clientEditable,
        });
      }
      return createCustomFieldDefinition({
        entity: draft.entity,
        label: draft.label,
        type: draft.type,
        options,
        showOnCard: draft.showOnCard,
        clientEditable: draft.clientEditable,
      });
    });
  }

  return (
    <div className="space-y-8">
      {saved ? <p className="text-sm text-muted-foreground">{t("saved")}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {sections.map((section) => (
        <section key={section.entity} aria-labelledby={`fields-${section.entity}`} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id={`fields-${section.entity}`} className="text-lg font-semibold">
              {section.title}
            </h2>
            <Button type="button" className="h-12" onClick={() => openCreate(section.entity)}>
              {t("add")}
            </Button>
          </div>
          {section.fields.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
          <ul className="divide-y rounded-lg border">
            {section.fields.map((field) => (
              <li key={field.id} className="flex flex-wrap items-center gap-2 px-3 py-3">
                <div className="min-w-40 flex-1">
                  <p className="font-medium">{field.label}</p>
                  <p className="text-sm text-muted-foreground">{t(`types.${field.type}`)}</p>
                </div>
                {field.showOnCard ? <Badge variant="secondary">{t("shownOnCard")}</Badge> : null}
                {!field.isActive ? <Badge variant="outline">{t("hidden")}</Badge> : null}
                <Button type="button" variant="outline" onClick={() => openEdit(field)}>
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(() => updateCustomFieldDefinition({ id: field.id, isActive: !field.isActive }))
                  }
                >
                  {field.isActive ? t("hide") : t("show")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => moveCustomFieldDefinition({ id: field.id, direction: "up" }))}
                >
                  {t("moveUp")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => moveCustomFieldDefinition({ id: field.id, direction: "down" }))}
                >
                  {t("moveDown")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? t("edit") : t("add")}</DialogTitle>
          </DialogHeader>
          {draft ? (
            <div className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span>{t("label")}</span>
                <Input value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
              </label>
              <label className="block space-y-1 text-sm">
                <span>{t("type")}</span>
                <Select
                  value={draft.type}
                  onValueChange={(type) => setDraft({ ...draft, type: type as FieldType })}
                  disabled={Boolean(draft.id)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(`types.${type}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {draft.id ? <span className="text-muted-foreground">{t("typeLocked")}</span> : null}
              </label>
              {draft.type === "select" || draft.type === "multi" ? (
                <label className="block space-y-1 text-sm">
                  <span>{t("options")}</span>
                  <Textarea
                    value={draft.options}
                    onChange={(event) => setDraft({ ...draft, options: event.target.value })}
                    rows={5}
                  />
                  <span className="text-muted-foreground">{t("optionsHint")}</span>
                </label>
              ) : null}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-on-card"
                  checked={draft.showOnCard}
                  onCheckedChange={(checked) => setDraft({ ...draft, showOnCard: checked === true })}
                />
                <label htmlFor="show-on-card" className="text-sm">
                  {t("showOnCard")}
                </label>
              </div>
              {draft.entity === "client" ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="client-editable"
                    checked={draft.clientEditable}
                    onCheckedChange={(checked) => setDraft({ ...draft, clientEditable: checked === true })}
                  />
                  <label htmlFor="client-editable" className="text-sm">
                    {t("clientEditable")}
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" className="h-12" disabled={pending} onClick={saveDraft}>
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
