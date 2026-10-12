"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { updateMyClientAttributes } from "@/actions/client-profile";
import type { FieldDef } from "@/lib/custom-fields/values";
import { useT } from "@/lib/terms/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function choices(def: FieldDef) {
  return def.matchProductTags ? def.options.filter((option) => option.value !== "all") : def.options;
}

function initialValue(def: FieldDef, values: Record<string, unknown>): unknown {
  const value = values[def.key];
  if (!def.matchProductTags) return value ?? null;
  if (Array.isArray(value)) return value.filter((item) => item !== "all");
  if (value === "all") return null;
  return value ?? null;
}

export function ClientFieldsSection({
  clientId,
  definitions,
  values,
}: {
  clientId: string;
  definitions: FieldDef[];
  values: Record<string, unknown>;
}) {
  const t = useT("customFields");
  const editable = definitions.filter((def) => def.clientEditable && def.isActive);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const next: Record<string, unknown> = {};
    for (const def of editable) next[def.key] = initialValue(def, values);
    return next;
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  if (editable.length === 0) return null;

  async function handleSave() {
    setSaving(true);
    setStatus("idle");
    const payload: Record<string, unknown> = {};
    for (const def of editable) {
      const value = draft[def.key];
      payload[def.key] = Array.isArray(value) && value.length === 0 ? null : value ?? null;
    }
    const result = await updateMyClientAttributes(clientId, payload);
    setSaving(false);
    if (result.success) {
      setStatus("saved");
      return;
    }
    setError(result.error);
    setStatus("error");
  }

  return (
    <div className="space-y-4 border-t border-[var(--line)] pt-6">
      <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--ink)]">
        {t("account.title")}
      </h2>
      {editable.map((def) => (
        <div key={def.id} className="space-y-2">
          <p className="text-sm text-[var(--ink)]">{def.label}</p>
          {def.type === "multi" || def.type === "select" ? (
            <div className="flex flex-wrap gap-2">
              {choices(def).map((option) => {
                const current = draft[def.key];
                const active =
                  def.type === "multi"
                    ? Array.isArray(current) && current.includes(option.value)
                    : current === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setStatus("idle");
                      setDraft((prev) => {
                        if (def.type === "select") {
                          return { ...prev, [def.key]: active ? null : option.value };
                        }
                        const selected = new Set(Array.isArray(prev[def.key]) ? (prev[def.key] as string[]) : []);
                        if (active) selected.delete(option.value);
                        else selected.add(option.value);
                        const allowed = choices(def).map((item) => item.value);
                        return { ...prev, [def.key]: allowed.filter((item) => selected.has(item)) };
                      });
                    }}
                    className={`border px-3 py-1.5 text-xs uppercase tracking-[0.15em] transition-colors ${
                      active
                        ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--ivory)]"
                        : "border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--ink)]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : def.type === "boolean" ? (
            <button
              type="button"
              aria-pressed={draft[def.key] === true}
              onClick={() => {
                setStatus("idle");
                setDraft((prev) => ({ ...prev, [def.key]: prev[def.key] !== true }));
              }}
              className="border px-3 py-1.5 text-xs uppercase tracking-[0.15em]"
            >
              {draft[def.key] === true ? t("card.yes") : t("card.no")}
            </button>
          ) : (
            <Input
              type={def.type === "number" ? "number" : def.type === "date" ? "date" : "text"}
              value={draft[def.key] == null ? "" : String(draft[def.key])}
              onChange={(event) => {
                setStatus("idle");
                const raw = event.target.value;
                setDraft((prev) => ({
                  ...prev,
                  [def.key]: def.type === "number" ? (raw === "" ? null : Number(raw)) : raw === "" ? null : raw,
                }));
              }}
            />
          )}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button variant="default"  onClick={handleSave} disabled={saving}>
          {saving ? <Loader2Icon className="mr-2 size-4 animate-spin" /> : null}
          {t("account.save")}
        </Button>
        {status === "saved" ? <span className="text-xs text-[var(--ink-soft)]">{t("account.saved")}</span> : null}
        {status === "error" ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
