import { describe, expect, it } from "vitest";
import {
  fieldKeyFromLabel,
  formatAttributeValue,
  isRecommendedProduct,
  validateAttributeValues,
  type FieldDef,
} from "./values";

function def(partial: Partial<FieldDef> & Pick<FieldDef, "key" | "type">): FieldDef {
  return {
    id: "1",
    entity: "client",
    label: partial.key,
    options: [],
    isActive: true,
    showOnCard: true,
    clientEditable: false,
    matchProductTags: false,
    sort: 10,
    ...partial,
  };
}

const hair = def({
  key: "hair_types",
  type: "multi",
  label: "Hair profile",
  options: [
    { value: "blonde", label: "Blonde" },
    { value: "color-treated", label: "Color Treated" },
    { value: "red", label: "Red" },
  ],
});

describe("fieldKeyFromLabel", () => {
  it("slugs a label and suffixes collisions", () => {
    expect(fieldKeyFromLabel("Nail shape", new Set())).toBe("nail_shape");
    expect(fieldKeyFromLabel("Nail shape", new Set(["nail_shape"]))).toBe("nail_shape_2");
    expect(fieldKeyFromLabel("2nd visit", new Set())).toBe("f_2nd_visit");
  });
});

describe("validateAttributeValues", () => {
  it("rejects unknown multi choices, string numbers, and impossible dates", () => {
    expect(validateAttributeValues([hair], { hair_types: ["blonde", "x"] })).toEqual({
      ok: false,
      errors: { hair_types: "invalid" },
    });
    expect(validateAttributeValues([hair], { hair_types: [] })).toEqual({
      ok: true,
      set: {},
      unset: ["hair_types"],
    });
    expect(
      validateAttributeValues([def({ key: "visits", type: "number" })], { visits: "5" }),
    ).toEqual({ ok: false, errors: { visits: "invalid" } });
    expect(
      validateAttributeValues([def({ key: "when", type: "date" })], { when: "2026-02-30" }),
    ).toEqual({ ok: false, errors: { when: "invalid" } });
  });
});

describe("formatAttributeValue", () => {
  it("prints option labels and marks a removed choice", () => {
    expect(formatAttributeValue(hair, ["blonde", "color-treated"])).toBe("Blonde, Color Treated");
    expect(
      formatAttributeValue(
        def({
          key: "shape",
          type: "select",
          options: [{ value: "oval", label: "Oval" }],
        }),
        "gone",
      ),
    ).toBe("gone (removed)");
  });
});

describe("isRecommendedProduct", () => {
  it("matches the all tag and skips a client with no tags", () => {
    expect(isRecommendedProduct(["all"], new Set(["curly"]))).toBe(true);
    expect(isRecommendedProduct(["curly"], new Set())).toBe(false);
  });
});
