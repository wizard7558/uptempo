import { describe, it, expect } from "vitest";
import { createServiceSchema, updateServiceSchema } from "./service";

const base = { name: "Cut", defaultDurationMinutes: 30 };
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("service timing fields", () => {
  it("accepts a service with no timing fields", () => {
    expect(createServiceSchema.safeParse(base).success).toBe(true);
  });

  it("accepts valid buffers, notice, horizon, grid, location type and variant", () => {
    const r = createServiceSchema.safeParse({
      ...base,
      bufferBeforeMin: 10,
      bufferAfterMin: 240,
      minNoticeMin: 0,
      maxAdvanceDays: 365,
      slotIntervalMin: 30,
      locationType: "virtual",
      variantOfServiceId: OTHER,
    });
    expect(r.success).toBe(true);
  });

  it("accepts null for the inherit-from-business fields", () => {
    const r = createServiceSchema.safeParse({
      ...base,
      minNoticeMin: null,
      maxAdvanceDays: null,
      slotIntervalMin: null,
      variantOfServiceId: null,
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ["bufferBeforeMin", -1],
    ["bufferBeforeMin", 241],
    ["bufferAfterMin", 241],
    ["bufferAfterMin", 1.5],
    ["minNoticeMin", 20161],
    ["maxAdvanceDays", 0],
    ["maxAdvanceDays", 731],
    ["slotIntervalMin", 25],
    ["locationType", "mobile"],
    ["variantOfServiceId", "not-a-uuid"],
  ])("rejects %s = %s", (field, value) => {
    expect(createServiceSchema.safeParse({ ...base, [field]: value }).success).toBe(false);
  });

  it("an update can't make a service a version of itself", () => {
    expect(updateServiceSchema.safeParse({ id: ID, variantOfServiceId: ID }).success).toBe(false);
    expect(updateServiceSchema.safeParse({ id: ID, variantOfServiceId: OTHER }).success).toBe(true);
    expect(updateServiceSchema.safeParse({ id: ID, variantOfServiceId: null }).success).toBe(true);
  });
});
