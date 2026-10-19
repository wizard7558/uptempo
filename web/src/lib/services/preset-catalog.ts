import {
  HAIR_SALON_PRESET_KEYS,
  hairSalon,
} from "@/lib/verticals/hair-salon";
import { getVertical } from "@/lib/verticals";

/**
 * Curated service templates business owners can add to their catalog with one click.
 * Each preset becomes a row in `services` with the listed defaults; owners
 * can edit afterwards or use it verbatim. Staff members then opt in and override
 * pricing per their own services page.
 *
 * Pricing is a sensible national-average suggestion, not a recommendation.
 */
export interface ServicePreset {
  /** Stable identifier used by preset import; non-hair keys are pack-scoped. */
  key: string;
  name: string;
  description: string;
  category: string;
  defaultDurationMinutes: number;
  /** Suggested price in cents; owner overrides on save. */
  suggestedPriceCents: number;
  /** Optional active/processing split for color/perm services. */
  activeMinutes?: number;
  processingMinutes?: number;
  depositType?: "fixed" | "percent";
  depositAmount?: number;
  isClass?: number;
  classCapacity?: number;
}

export const SERVICE_PRESETS: ServicePreset[] = hairSalon.serviceTemplates.map(
  (t, i) => {
    const preset: ServicePreset = {
      key: HAIR_SALON_PRESET_KEYS[i],
      name: t.name,
      description: t.description ?? "",
      category: t.category,
      defaultDurationMinutes: t.minutes,
      suggestedPriceCents: t.priceCents,
    };
    if (t.activeMinutes !== undefined) preset.activeMinutes = t.activeMinutes;
    if (t.processingMinutes !== undefined) {
      preset.processingMinutes = t.processingMinutes;
    }
    return preset;
  },
);

/** Returns the service templates for an industry pack as importable presets. */
export function getServicePresetsForIndustry(
  industry: string | null | undefined,
): ServicePreset[] {
  const vertical = getVertical(industry);
  if (vertical.id === "hair_salon") return SERVICE_PRESETS;

  return vertical.serviceTemplates.map((template) => {
    const preset: ServicePreset = {
      key: `${vertical.id}:${encodeURIComponent(template.name)}`,
      name: template.name,
      description: template.description ?? "",
      category: template.category,
      defaultDurationMinutes: template.minutes,
      suggestedPriceCents: template.priceCents,
    };
    if (template.activeMinutes !== undefined) {
      preset.activeMinutes = template.activeMinutes;
    }
    if (template.processingMinutes !== undefined) {
      preset.processingMinutes = template.processingMinutes;
    }
    if (template.deposit !== undefined) {
      preset.depositType = template.deposit.type;
      preset.depositAmount = template.deposit.amount;
    }
    if (template.isClass !== undefined) {
      preset.isClass = template.isClass ? 1 : 0;
    }
    if (template.capacity !== undefined) {
      preset.classCapacity = template.capacity;
    }
    return preset;
  });
}

/**
 * Returns presets that don't already exist in the business catalog
 * (matched case-insensitively on name).
 */
export function filterUnusedPresets(
  presets: ServicePreset[],
  existingNames: string[],
): ServicePreset[] {
  const lower = new Set(existingNames.map((n) => n.toLowerCase().trim()));
  return presets.filter((p) => !lower.has(p.name.toLowerCase().trim()));
}
