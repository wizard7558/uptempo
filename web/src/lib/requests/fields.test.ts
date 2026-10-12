import { describe, expect, it } from "vitest";
import { VERTICALS } from "@/lib/verticals";
import {
  buildAnswersSchema,
  dollarsToCents,
  fieldLabelKey,
  resolveRequestFields,
} from "./fields";

describe("resolveRequestFields", () => {
  it("resolves the tattoo keys to 5 defs and the home keys to 4", () => {
    expect(resolveRequestFields(VERTICALS.tattoo.requestFields)).toHaveLength(5);
    expect(resolveRequestFields(VERTICALS.home_services.requestFields)).toHaveLength(4);
  });

  it("turns an unknown key into an optional text field", () => {
    expect(resolveRequestFields(["mystery"])).toEqual([{ key: "mystery", kind: "text", required: false }]);
  });

  it("falls back to description and photos when nothing is configured", () => {
    for (const none of [undefined, []]) {
      expect(resolveRequestFields(none).map((d) => d.key)).toEqual(["description", "photos"]);
    }
  });
});

describe("buildAnswersSchema", () => {
  const tattoo = buildAnswersSchema(resolveRequestFields(VERTICALS.tattoo.requestFields));

  it("rejects a missing placement", () => {
    const r = tattoo.safeParse({ size: "small" });
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === "placement")).toBe(true);
  });

  it("rejects a size that is not one of the options", () => {
    expect(tattoo.safeParse({ placement: "arm", size: "huge" }).success).toBe(false);
  });

  it("accepts the required fields alone and ignores blank optional ones", () => {
    const r = tattoo.safeParse({ placement: " left arm ", size: "small", style: "", budget: "" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ placement: "left arm", size: "small" });
  });

  it("accepts a typed budget of 400 as 40000 cents", () => {
    const r = tattoo.safeParse({ placement: "arm", size: "small", budget: "400" });
    expect(r.data).toMatchObject({ budget: 40000 });
    expect(tattoo.safeParse({ placement: "arm", size: "small", budget: "lots" }).success).toBe(false);
  });

  it("validates the address", () => {
    const home = buildAnswersSchema(resolveRequestFields(VERTICALS.home_services.requestFields));
    const base = { description: "Leaky tap" };
    expect(home.safeParse(base).success).toBe(false);
    const address = { line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701" };
    expect(home.safeParse({ ...base, address }).success).toBe(true);
    expect(home.safeParse({ ...base, address: { ...address, postalCode: "!" } }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("converts dollars to cents", () => {
    expect(dollarsToCents("$1,250.50")).toBe(125050);
    expect(dollarsToCents("abc")).toBeNull();
  });
  it("names the label key only for known fields", () => {
    expect(fieldLabelKey("placement")).toBe("requests.fields.placement.label");
    expect(fieldLabelKey("mystery")).toBe("");
  });
});
