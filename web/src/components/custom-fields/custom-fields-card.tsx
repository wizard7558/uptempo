"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { listCustomFieldDefinitions, setEntityAttributes } from "@/actions/custom-fields";
import {
  formatAttributeValue,
  type FieldDef,
  type FieldEntity,
} from "@/lib/custom-fields/values";
import { useT } from "@/lib/terms/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const UNSET = "__unset__";

export function CustomFieldsCard({
  entity,
  ownerId,
  definitions,
  values,
  canEdit,
}: {
  entity: FieldEntity;
  ownerId: string;
  definitions: FieldDef[];
  values: Record<string, unknown>;
  canEdit: boolean;
}) {
  const t = useT("customFields");
  const router = useRouter();
  const visible = definitions.filter((def) => def.isActive && def.showOnCard);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [pending, startTransition] = useTransition();

  function startEdit() {
    setDraft(draftFrom(visible, values));
    setEditing(true);
  }

  function save() {
    const payload: Record<string, unknown> = {};
    for (const def of visible) payload[def.key] = payloadFor(def, draft[def.key]);
    startTransition(async () => {
      const result = await setEntityAttributes({ entity, ownerId, values: payload });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("card.saved"));
      setEditing(false);
      router.refresh();
    });
  }

  const titleId = `custom-fields-${entity}-${ownerId}`;
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle id={titleId}>{t(`card.title.${entity}`)}</CardTitle>
        {canEdit && visible.length > 0 && !editing ? (
          <Button type="button" variant="outline"  onClick={startEdit}>
            {t("card.edit")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {visible.map((def) => (
          <div key={def.id} className="space-y-1">
            <p className="text-sm font-medium">{def.label}</p>
            {editing ? (
              <FieldEditor
                def={def}
                value={draft[def.key]}
                notSet={t("card.notSet")}
                yes={t("card.yes")}
                no={t("card.no")}
                onChange={(value) => setDraft((prev) => ({ ...prev, [def.key]: value }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {isUnset(values[def.key]) ? t("card.notSet") : formatAttributeValue(def, values[def.key])}
              </p>
            )}
          </div>
        ))}
        {editing ? (
          <div className="flex gap-2">
            <Button type="button" onClick={save} disabled={pending}>
              {t("card.save")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
              {t("card.cancel")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Loads appointment definitions when the schedule panel opens. */
export function AppointmentFieldsSlot({
  appointmentId,
  values,
}: {
  appointmentId: string;
  values: Record<string, unknown>;
}) {
  const [definitions, setDefinitions] = useState<FieldDef[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCustomFieldDefinitions("appointment").then((defs) => {
      if (!cancelled) setDefinitions(defs);
    });
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  if (!definitions || definitions.length === 0) return null;
  return (
    <CustomFieldsCard
      entity="appointment"
      ownerId={appointmentId}
      definitions={definitions}
      values={values}
      canEdit
    />
  );
}

function isUnset(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function draftFrom(defs: FieldDef[], values: Record<string, unknown>): Record<string, unknown> {
  const draft: Record<string, unknown> = {};
  for (const def of defs) {
    const value = values[def.key];
    if (def.type === "multi" && Array.isArray(value)) {
      const allowed = new Set(def.options.map((option) => option.value));
      draft[def.key] = value.filter((item) => typeof item === "string" && allowed.has(item));
    } else {
      draft[def.key] = value ?? null;
    }
  }
  return draft;
}

function payloadFor(def: FieldDef, value: unknown): unknown {
  if (def.type === "text") {
    const text = typeof value === "string" ? value.trim() : "";
    return text === "" ? null : text;
  }
  if (def.type === "number") {
    if (value === "" || value == null) return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (def.type === "date") return typeof value === "string" && value ? value : null;
  if (def.type === "boolean") return value === true;
  if (def.type === "select") return typeof value === "string" && value ? value : null;
  if (def.type === "multi") return Array.isArray(value) && value.length > 0 ? value : null;
  return null;
}

function FieldEditor({
  def,
  value,
  notSet,
  yes,
  no,
  onChange,
}: {
  def: FieldDef;
  value: unknown;
  notSet: string;
  yes: string;
  no: string;
  onChange: (value: unknown) => void;
}) {
  if (def.type === "text") {
    return (
      <Input
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (def.type === "number") {
    return (
      <Input
        type="number"
        value={value == null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    );
  }
  if (def.type === "date") {
    const raw = typeof value === "string" ? value : "";
    const selected = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseISO(raw) : undefined;
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-start">
            {selected ? format(selected, "MMM d, yyyy") : notSet}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(day) => onChange(day ? format(day, "yyyy-MM-dd") : null)}
          />
        </PopoverContent>
      </Popover>
    );
  }
  if (def.type === "boolean") {
    const on = value === true;
    return (
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={on} onCheckedChange={(checked) => onChange(checked === true)} />
        {on ? yes : no}
      </label>
    );
  }
  if (def.type === "select") {
    const current = typeof value === "string" && value ? value : UNSET;
    return (
      <Select value={current} onValueChange={(next) => onChange(next === UNSET ? null : next)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNSET}>{notSet}</SelectItem>
          {def.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  const selected = new Set(Array.isArray(value) ? value.map(String) : []);
  return (
    <div className="flex flex-wrap gap-2">
      {def.options.map((option) => {
        const pressed = selected.has(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => {
              const next = new Set(selected);
              if (pressed) next.delete(option.value);
              else next.add(option.value);
              onChange(def.options.map((item) => item.value).filter((item) => next.has(item)));
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              pressed
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
