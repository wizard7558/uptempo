import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSISTANT_TASKS,
  getDefaultAssistantTasksForIndustry,
} from "@/lib/services/default-assistant-tasks";
import {
  SERVICE_CATEGORY_LABELS,
  SERVICE_CATEGORY_OPTIONS,
} from "@/lib/services/categories";
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_OPTIONS,
} from "@/lib/expenses/categories";
import { SERVICE_TEMPLATES } from "@/lib/onboarding/service-templates";
import { SERVICE_PRESETS } from "@/lib/services/preset-catalog";
import legacy from "./__fixtures__/hair-salon-legacy.json";
import { getVertical, listVerticals, VERTICALS } from "./index";
import { verticalSchema } from "./types";

const packs = listVerticals();

describe("verticals registry", () => {
  it("lists all 8 packs in display order", () => {
    expect(packs.map((p) => p.id)).toEqual([
      "hair_salon",
      "barber",
      "nail_salon",
      "tattoo",
      "massage_wellness",
      "personal_training",
      "home_services",
      "general",
    ]);
  });

  it("ids are unique and match registry keys", () => {
    expect(new Set(packs.map((p) => p.id)).size).toBe(packs.length);
    for (const [key, pack] of Object.entries(VERTICALS)) {
      expect(pack.id).toBe(key);
    }
  });

  it("getVertical falls back to general", () => {
    expect(getVertical("nope").id).toBe("general");
    expect(getVertical(undefined).id).toBe("general");
    expect(getVertical(null).id).toBe("general");
    expect(getVertical("toString").id).toBe("general");
    expect(getVertical("tattoo").id).toBe("tattoo");
  });

  describe.each(packs.map((p) => [p.id, p] as const))("%s", (_id, pack) => {
    it("passes the zod schema", () => {
      expect(verticalSchema.safeParse(pack).success).toBe(true);
    });

    it("template categories exist in the pack", () => {
      const slugs = new Set(pack.categories.map((c) => c.slug));
      for (const t of pack.serviceTemplates) {
        expect(slugs.has(t.category), `${t.name} -> ${t.category}`).toBe(true);
      }
    });

    it("resolves assistant tasks from the pack without inventing defaults", () => {
      expect(getDefaultAssistantTasksForIndustry(pack.id)).toEqual(
        (pack.taskPresets ?? []).map((task) => ({
          name: task.name,
          defaultDurationMinutes: task.minutes,
        })),
      );
    });

    it("has no duplicate template names", () => {
      const names = pack.serviceTemplates.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it("client field keys are unique and match the definition key rule", () => {
      const keys = pack.clientFields.map((field) => field.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) {
        expect(key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
      }
    });
  });
});

describe("hair_salon legacy parity", () => {
  it("SERVICE_PRESETS matches the fixture", () => {
    expect(SERVICE_PRESETS).toEqual(legacy.SERVICE_PRESETS);
  });
  it("SERVICE_TEMPLATES matches the fixture", () => {
    expect(SERVICE_TEMPLATES).toEqual(legacy.SERVICE_TEMPLATES);
  });
  it("service categories match the fixture", () => {
    expect(SERVICE_CATEGORY_OPTIONS).toEqual(legacy.SERVICE_CATEGORY_OPTIONS);
    expect(SERVICE_CATEGORY_LABELS).toEqual(legacy.SERVICE_CATEGORY_LABELS);
  });
  it("expense categories match the fixture", () => {
    expect(EXPENSE_CATEGORY_OPTIONS).toEqual(legacy.EXPENSE_CATEGORY_OPTIONS);
    expect(EXPENSE_CATEGORY_LABELS).toEqual(legacy.EXPENSE_CATEGORY_LABELS);
  });
  it("default assistant tasks match the fixture", () => {
    expect(DEFAULT_ASSISTANT_TASKS).toEqual(legacy.DEFAULT_ASSISTANT_TASKS);
  });
  it("unknown industries resolve assistant tasks from the general pack", () => {
    expect(getDefaultAssistantTasksForIndustry("unknown-industry")).toEqual(
      (VERTICALS.general.taskPresets ?? []).map((task) => ({
        name: task.name,
        defaultDurationMinutes: task.minutes,
      })),
    );
  });
});
