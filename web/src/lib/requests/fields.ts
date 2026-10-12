import { z } from "zod";

export type RequestFieldKind =
  | "text"
  | "textarea"
  | "select"
  | "money"
  | "photos"
  | "address"
  | "days";

export type RequestFieldDef = {
  key: string;
  kind: RequestFieldKind;
  required: boolean;
  options?: string[];
  maxPhotos?: number;
};

export const KNOWN_REQUEST_FIELDS: Record<string, Omit<RequestFieldDef, "key">> = {
  placement: { kind: "text", required: true },
  size: { kind: "select", required: true, options: ["small", "medium", "large", "xlarge"] },
  style: { kind: "text", required: false },
  budget: { kind: "money", required: false },
  references: { kind: "photos", required: false, maxPhotos: 5 },
  description: { kind: "textarea", required: true },
  photos: { kind: "photos", required: false, maxPhotos: 5 },
  address: { kind: "address", required: true },
  preferred_days: { kind: "days", required: false },
};

/** Unknown key becomes an optional text field. Nothing configured gives description + photos. */
export function resolveRequestFields(keys: string[] | undefined): RequestFieldDef[] {
  const list = keys && keys.length > 0 ? keys : ["description", "photos"];
  return list.map((key) => {
    const known = KNOWN_REQUEST_FIELDS[key];
    return known ? { key, ...known } : { key, kind: "text" as const, required: false };
  });
}

/** Dollars typed by a person ("400", "$1,250.50") to whole cents. null when it isn't an amount. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

function schemaFor(def: RequestFieldDef): z.ZodType | null {
  let base: z.ZodType;
  switch (def.kind) {
    case "text":
      base = z.string().trim().min(1, "required").max(500);
      break;
    case "textarea":
      base = z.string().trim().min(1, "required").max(4000);
      break;
    case "select":
      base = z.string().refine((v) => (def.options ?? []).includes(v), "required");
      break;
    case "money":
      // Strings are dollars as typed; numbers are already cents.
      base = z.preprocess(
        (v) => (typeof v === "string" ? (dollarsToCents(v) ?? v) : v),
        z.number().int().min(0).max(10_000_000),
      );
      break;
    case "address":
      base = z.object({
        line1: z.string().trim().min(1, "required").max(200),
        line2: z.string().trim().max(200).optional(),
        city: z.string().trim().min(1, "required").max(100),
        region: z.string().trim().min(1, "required").max(50),
        postalCode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,10}$/, "required"),
      });
      break;
    default:
      return null; // photos and days are not answers
  }
  return def.required
    ? z.preprocess(blankToUndefined, base)
    : z.preprocess(blankToUndefined, base.optional());
}

/** Validates the `answers` object for the given fields. Photos and days are excluded. */
export function buildAnswersSchema(defs: RequestFieldDef[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const def of defs) {
    const s = schemaFor(def);
    if (s) shape[def.key] = s;
  }
  return z.object(shape) as unknown as z.ZodType<Record<string, unknown>>;
}

export function fieldLabelKey(key: string): string {
  return key in KNOWN_REQUEST_FIELDS ? `requests.fields.${key}.label` : "";
}
