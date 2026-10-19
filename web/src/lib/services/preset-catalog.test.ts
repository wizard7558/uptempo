import { describe, it, expect } from "vitest";
import {
  SERVICE_PRESETS,
  getServicePresetsForIndustry,
  filterUnusedPresets,
} from "./preset-catalog";
import { SERVICE_CATEGORY_OPTIONS } from "./categories";
import { listVerticals } from "@/lib/verticals";

const validCategories = new Set<string>(SERVICE_CATEGORY_OPTIONS.map((o) => o.value));

describe("preset catalog", () => {
  it("has unique keys", () => {
    const keys = SERVICE_PRESETS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses only known categories", () => {
    for (const p of SERVICE_PRESETS) {
      expect(validCategories.has(p.category)).toBe(true);
    }
  });

  it("has duration in valid range", () => {
    for (const p of SERVICE_PRESETS) {
      expect(p.defaultDurationMinutes).toBeGreaterThanOrEqual(5);
      expect(p.defaultDurationMinutes).toBeLessThanOrEqual(480);
    }
  });

  it("active+processing fits inside duration when both set", () => {
    for (const p of SERVICE_PRESETS) {
      if (p.activeMinutes != null && p.processingMinutes != null) {
        expect(p.activeMinutes + p.processingMinutes).toBeLessThanOrEqual(
          p.defaultDurationMinutes,
        );
      }
    }
  });

  it("non-negative suggested prices", () => {
    for (const p of SERVICE_PRESETS) {
      expect(p.suggestedPriceCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("industry preset catalog", () => {
  it("keeps the legacy hair-salon presets unchanged", () => {
    expect(getServicePresetsForIndustry("hair_salon")).toEqual(SERVICE_PRESETS);
  });

  it("maps every vertical with category slugs and globally unique keys", () => {
    const allPresets = listVerticals().flatMap((vertical) => {
      const presets = getServicePresetsForIndustry(vertical.id);
      const categories = new Set(vertical.categories.map((category) => category.slug));

      expect(presets.length).toBe(vertical.serviceTemplates.length);
      for (const preset of presets) {
        expect(categories.has(preset.category), `${vertical.id}: ${preset.category}`).toBe(true);
      }
      return presets;
    });
    const keys = allPresets.map((preset) => preset.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses the general pack for missing and unknown industry ids", () => {
    expect(getServicePresetsForIndustry(undefined)).toEqual(
      getServicePresetsForIndustry("general"),
    );
    expect(getServicePresetsForIndustry("unknown-industry")).toEqual(
      getServicePresetsForIndustry("general"),
    );
  });

  it("preserves tattoo deposits and personal-training class capacity", () => {
    const tattooPreset = getServicePresetsForIndustry("tattoo").find(
      (preset) => preset.name === "Small piece",
    );
    const classPreset = getServicePresetsForIndustry("personal_training").find(
      (preset) => preset.name === "Bootcamp",
    );

    expect(tattooPreset).toMatchObject({
      key: "tattoo:Small%20piece",
      category: "custom",
      depositType: "fixed",
      depositAmount: 5000,
    });
    expect(classPreset).toMatchObject({
      key: "personal_training:Bootcamp",
      category: "classes",
      isClass: 1,
      classCapacity: 12,
    });
  });
});

describe("filterUnusedPresets", () => {
  it("removes presets that already exist by name (case-insensitive)", () => {
    const filtered = filterUnusedPresets(
      [
        { ...SERVICE_PRESETS[0] },
        { ...SERVICE_PRESETS[1] },
      ],
      [SERVICE_PRESETS[0].name.toUpperCase()],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe(SERVICE_PRESETS[1].key);
  });

  it("trims whitespace when comparing names", () => {
    const filtered = filterUnusedPresets(
      [{ ...SERVICE_PRESETS[0] }],
      [`  ${SERVICE_PRESETS[0].name}  `],
    );
    expect(filtered).toHaveLength(0);
  });

  it("keeps all presets when no names match", () => {
    const filtered = filterUnusedPresets(SERVICE_PRESETS, ["Nonexistent"]);
    expect(filtered).toHaveLength(SERVICE_PRESETS.length);
  });
});
