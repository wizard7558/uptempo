import { randomUUID } from "node:crypto";

export type ChecklistTemplateItem = { id: string; label: string };

const MAX_ITEMS = 30;
const MAX_LABEL = 120;
const MAX_ID = 80;

/**
 * Drop blank steps, keep existing ids, and refuse a list that is too long
 * or a label that does not fit the column. A repeated id gets a new one so
 * two steps cannot share a source key.
 */
export function normalizeChecklistItems(
  raw: { id?: string; label: string }[],
): { ok: true; items: ChecklistTemplateItem[] } | { ok: false; error: "tooMany" | "label" } {
  const trimmed = raw
    .map((item) => ({ id: item.id?.trim() ?? "", label: item.label.trim() }))
    .filter((item) => item.label.length > 0);
  if (trimmed.length > MAX_ITEMS) return { ok: false, error: "tooMany" };
  if (trimmed.some((item) => item.label.length > MAX_LABEL)) return { ok: false, error: "label" };
  const seen = new Set<string>();
  const items = trimmed.map((item) => {
    let id = item.id;
    if (!id || id.length > MAX_ID || seen.has(id)) id = randomUUID();
    seen.add(id);
    return { id, label: item.label };
  });
  return { ok: true, items };
}
