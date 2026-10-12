import { describe, expect, it } from "vitest";
import { createProductSchema, updateProductSchema } from "./product";

describe("createProductSchema", () => {
  it("accepts a minimal valid product", () => {
    const r = createProductSchema.safeParse({ name: "K18 AirWash", priceCents: 3200 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("K18 AirWash");
      expect(r.data.brand).toBeNull();
    }
  });

  it("requires a name", () => {
    expect(createProductSchema.safeParse({ name: "  ", priceCents: 100 }).success).toBe(
      false,
    );
  });

  it("requires a price", () => {
    expect(
      createProductSchema.safeParse({ name: "X" } as unknown as {
        name: string;
        priceCents: number;
      }).success,
    ).toBe(false);
  });

  it("rejects prices over the sanity cap", () => {
    expect(
      createProductSchema.safeParse({ name: "X", priceCents: 1_000_01 }).success,
    ).toBe(false);
  });

  it("trims text and coerces empty optional fields to null", () => {
    const r = createProductSchema.safeParse({
      name: "  Dream Coat  ",
      priceCents: 3000,
      brand: "  Color Wow  ",
      photoUrl: "",
      description: "   ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Dream Coat");
      expect(r.data.brand).toBe("Color Wow");
      expect(r.data.photoUrl).toBeNull();
      expect(r.data.description).toBeNull();
    }
  });

  it("accepts product tags and rejects a 21st tag", () => {
    const ok = createProductSchema.safeParse({
      name: "X",
      priceCents: 100,
      tags: ["blonde", "extensions"],
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.tags).toEqual(["blonde", "extensions"]);
    expect(
      createProductSchema.safeParse({
        name: "X",
        priceCents: 100,
        tags: Array.from({ length: 21 }, (_, index) => `tag${index}`),
      }).success,
    ).toBe(false);
  });
});

describe("updateProductSchema", () => {
  it("requires a uuid id and allows partial fields", () => {
    const r = updateProductSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      priceCents: 2600,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(updateProductSchema.safeParse({ priceCents: 2600 }).success).toBe(false);
  });
});
