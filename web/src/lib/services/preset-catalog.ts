import {
  HAIR_SALON_PRESET_KEYS,
  hairSalon,
} from "@/lib/verticals/hair-salon";
import type { ServiceCategory } from "./categories";

/**
 * Curated salon-service templates owners can one-click add to their catalog.
 * Each preset becomes a row in `services` with the listed defaults; owners
 * can edit afterwards or use it verbatim. Stylists then opt in and override
 * pricing per their own services page.
 *
 * Pricing is a sensible national-average suggestion, not a recommendation.
 */
export interface ServicePreset {
  /** Stable identifier (snake_case). Used so a preset isn't re-added when
   * already present in the catalog (matched on name). */
  key: string;
  name: string;
  description: string;
  category: ServiceCategory;
  defaultDurationMinutes: number;
  /** Suggested price in cents; owner overrides on save. */
  suggestedPriceCents: number;
  /** Optional active/processing split for color/perm services. */
  activeMinutes?: number;
  processingMinutes?: number;
}

export const SERVICE_PRESETS: ServicePreset[] = hairSalon.serviceTemplates.map(
  (t, i) => {
    const preset: ServicePreset = {
      key: HAIR_SALON_PRESET_KEYS[i],
      name: t.name,
      description: t.description ?? "",
      category: t.category as ServiceCategory,
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

/**
 * Returns presets that don't already exist in the salon catalog
 * (matched case-insensitively on name).
 */
export function filterUnusedPresets(
  presets: ServicePreset[],
  existingNames: string[],
): ServicePreset[] {
  const lower = new Set(existingNames.map((n) => n.toLowerCase().trim()));
  return presets.filter((p) => !lower.has(p.name.toLowerCase().trim()));
}
