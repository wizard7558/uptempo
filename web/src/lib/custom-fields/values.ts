import { format, parseISO } from "date-fns";

export const FIELD_ENTITIES = ["client", "appointment", "project", "request"] as const;
export const FIELD_TYPES = ["text", "select", "multi", "date", "number", "boolean"] as const;

export type FieldEntity = (typeof FIELD_ENTITIES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldOption = { value: string; label: string };

export type FieldDef = {
  id: string;
  entity: FieldEntity;
  key: string;
  label: string;
  type: FieldType;
  options: FieldOption[];
  isActive: boolean;
  showOnCard: boolean;
  clientEditable: boolean;
  matchProductTags: boolean;
  sort: number;
};

const KEY_MAX = 36;
const TEXT_MAX = 500;
const NUMBER_MAX = 1e9;
const MULTI_MAX = 50;

export function normalizeFieldOptions(
  options: (string | { value: string; label: string })[],
): FieldOption[] {
  const out: FieldOption[] = [];
  for (const option of options) {
    if (typeof option === "string") {
      out.push({ value: option, label: option });
      continue;
    }
    if (option && typeof option.value === "string" && typeof option.label === "string") {
      out.push({ value: option.value, label: option.label });
    }
  }
  return out;
}

/** Turns a label into a definition key. Collisions get `_2`, `_3`, and so on. */
export function fieldKeyFromLabel(label: string, taken: Set<string>): string {
  let key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (/^[0-9]/.test(key)) key = `f_${key}`;
  key = key.slice(0, KEY_MAX);
  if (!key) key = "field";
  if (!taken.has(key)) return key;
  let n = 2;
  while (taken.has(`${key}_${n}`)) n += 1;
  const suffix = `_${n}`;
  return `${key.slice(0, KEY_MAX - suffix.length)}${suffix}`;
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateAttributeValues(
  defs: FieldDef[],
  input: Record<string, unknown>,
):
  | { ok: true; set: Record<string, unknown>; unset: string[] }
  | { ok: false; errors: Record<string, "unknown" | "invalid"> } {
  const byKey = new Map(defs.filter((def) => def.isActive).map((def) => [def.key, def]));
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  const errors: Record<string, "unknown" | "invalid"> = {};

  for (const [key, raw] of Object.entries(input)) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = "unknown";
      continue;
    }
    if (raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) {
      unset.push(key);
      continue;
    }
    const parsed = parseValue(def, raw);
    if (!parsed.ok) {
      errors[key] = "invalid";
      continue;
    }
    set[key] = parsed.value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, set, unset };
}

function parseValue(
  def: FieldDef,
  raw: unknown,
): { ok: true; value: unknown } | { ok: false } {
  if (def.type === "text") {
    if (typeof raw !== "string") return { ok: false };
    const value = raw.trim();
    if (!value || value.length > TEXT_MAX) return { ok: false };
    return { ok: true, value };
  }
  if (def.type === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw) || Math.abs(raw) > NUMBER_MAX) {
      return { ok: false };
    }
    return { ok: true, value: raw };
  }
  if (def.type === "date") {
    if (typeof raw !== "string" || !isRealDate(raw)) return { ok: false };
    return { ok: true, value: raw };
  }
  if (def.type === "boolean") {
    if (typeof raw !== "boolean") return { ok: false };
    return { ok: true, value: raw };
  }
  if (def.type === "select") {
    if (typeof raw !== "string" || !def.options.some((option) => option.value === raw)) {
      return { ok: false };
    }
    return { ok: true, value: raw };
  }
  if (!Array.isArray(raw) || raw.length > MULTI_MAX) return { ok: false };
  const order = new Map(def.options.map((option, index) => [option.value, index]));
  const picked = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !order.has(item)) return { ok: false };
    picked.add(item);
  }
  const value = [...picked].sort((a, b) => order.get(a)! - order.get(b)!);
  if (value.length === 0) return { ok: false };
  return { ok: true, value };
}

export function formatAttributeValue(def: FieldDef, value: unknown): string {
  if (def.type === "select") {
    const raw = String(value);
    return def.options.find((option) => option.value === raw)?.label ?? `${raw} (removed)`;
  }
  if (def.type === "multi") {
    const values = Array.isArray(value) ? value.map(String) : [];
    return values
      .map((item) => def.options.find((option) => option.value === item)?.label ?? `${item} (removed)`)
      .join(", ");
  }
  if (def.type === "boolean") return value ? "Yes" : "No";
  if (def.type === "date" && typeof value === "string") {
    return format(parseISO(value), "MMM d, yyyy");
  }
  if (def.type === "number" && typeof value === "number") {
    return value.toLocaleString("en-US");
  }
  return String(value ?? "");
}

export function productMatchTags(defs: FieldDef[], attributes: Record<string, unknown>): Set<string> {
  const tags = new Set<string>();
  for (const def of defs) {
    if (!def.matchProductTags) continue;
    const value = attributes[def.key];
    if (typeof value === "string" && value) tags.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item) tags.add(item);
      }
    }
  }
  return tags;
}

export function isRecommendedProduct(productTags: string[], clientTags: Set<string>): boolean {
  return clientTags.size > 0 && productTags.some((tag) => tag === "all" || clientTags.has(tag));
}
