import { describe, it, expect } from "vitest";
import {
  getServiceTemplatesForIndustry,
  SERVICE_TEMPLATES,
  templateToServiceRow,
  type ServiceTemplate,
} from "./service-templates";
import { getServicePresetsForIndustry } from "@/lib/services/preset-catalog";
import { listVerticals } from "@/lib/verticals";

const base: ServiceTemplate = {
  id: "t1",
  name: "Bootcamp",
  defaultDurationMinutes: 45,
  priceCents: 2000,
  category: "other",
};

describe("templateToServiceRow", () => {
  it("maps a class template to is_class 1 and its capacity", () => {
    const row = templateToServiceRow({ ...base, isClass: true, capacity: 12 });
    expect(row.isClass).toBe(1);
    expect(row.classCapacity).toBe(12);
    expect(row).toMatchObject({ name: "Bootcamp", defaultDurationMinutes: 45, priceCents: 2000 });
  });

  it("maps a plain template to is_class 0 and no capacity", () => {
    const row = templateToServiceRow(base);
    expect(row.isClass).toBe(0);
    expect(row.classCapacity).toBeNull();
  });

  it("adds pack-only optional service fields while preserving the base row", () => {
    expect(
      templateToServiceRow({
        ...base,
        description: "An instructor-led group workout.",
        activeMinutes: 50,
        processingMinutes: 10,
        deposit: { type: "percent", amount: 25 },
        isClass: true,
        capacity: 12,
      }),
    ).toEqual({
      name: "Bootcamp",
      defaultDurationMinutes: 45,
      priceCents: 2000,
      category: "other",
      isClass: 1,
      classCapacity: 12,
      description: "An instructor-led group workout.",
      activeMinutes: 50,
      processingMinutes: 10,
      depositType: "percent",
      depositAmount: 25,
    });
  });
});

describe("getServiceTemplatesForIndustry", () => {
  it("keeps the exact legacy hair onboarding template list", () => {
    expect(getServiceTemplatesForIndustry("hair_salon")).toBe(SERVICE_TEMPLATES);
  });

  it("uses pack-scoped ids and keeps class and deposit fields for other packs", () => {
    const training = getServiceTemplatesForIndustry("personal_training").find(
      (template) => template.name === "Bootcamp",
    );
    const tattoo = getServiceTemplatesForIndustry("tattoo").find(
      (template) => template.name === "Full-day session",
    );

    expect(training).toMatchObject({
      id: "personal_training:Bootcamp",
      category: "classes",
      defaultDurationMinutes: 45,
      priceCents: 2000,
      isClass: true,
      capacity: 12,
    });
    expect(templateToServiceRow(training!)).toMatchObject({
      category: "classes",
      defaultDurationMinutes: 45,
      priceCents: 2000,
      isClass: 1,
      classCapacity: 12,
    });
    expect(tattoo).toMatchObject({
      id: "tattoo:Full-day%20session",
      category: "custom",
      deposit: { type: "fixed", amount: 20000 },
    });
    expect(templateToServiceRow(tattoo!)).toMatchObject({
      depositType: "fixed",
      depositAmount: 20000,
    });
  });

  it("keeps non-hair onboarding ids aligned with every pack's service presets", () => {
    for (const pack of listVerticals().filter((item) => item.id !== "hair_salon")) {
      expect(getServiceTemplatesForIndustry(pack.id).map((template) => template.id)).toEqual(
        getServicePresetsForIndustry(pack.id).map((preset) => preset.key),
      );
    }
  });

  it("uses general templates for an unknown industry", () => {
    expect(getServiceTemplatesForIndustry("not-a-pack")).toEqual(
      getServiceTemplatesForIndustry("general"),
    );
  });
});
