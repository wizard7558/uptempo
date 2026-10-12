import { describe, expect, it } from "vitest";
import {
  createResourcesSchema,
  serviceNeedSchema,
  setServiceNeedsSchema,
  updateResourceSchema,
} from "./resource";

const UUID = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";

describe("createResourcesSchema", () => {
  const ok = { name: "Pedicure chair", kind: "chair", locationId: null, capacity: 1, count: 4 };

  it("accepts a valid chair set", () => {
    expect(createResourcesSchema.safeParse(ok).success).toBe(true);
    expect(createResourcesSchema.safeParse({ ...ok, locationId: UUID }).success).toBe(true);
  });

  it("trims and requires a name", () => {
    expect(createResourcesSchema.safeParse({ ...ok, name: "   " }).success).toBe(false);
    expect(createResourcesSchema.parse({ ...ok, name: "  Room  " }).name).toBe("Room");
  });

  it("rejects an unknown kind", () => {
    expect(createResourcesSchema.safeParse({ ...ok, kind: "sofa" }).success).toBe(false);
  });

  it("limits capacity to 1-500 and count to 1-20", () => {
    expect(createResourcesSchema.safeParse({ ...ok, capacity: 0 }).success).toBe(false);
    expect(createResourcesSchema.safeParse({ ...ok, capacity: 501 }).success).toBe(false);
    expect(createResourcesSchema.safeParse({ ...ok, count: 0 }).success).toBe(false);
    expect(createResourcesSchema.safeParse({ ...ok, count: 21 }).success).toBe(false);
  });
});

describe("updateResourceSchema", () => {
  it("needs an id and accepts partial changes", () => {
    expect(updateResourceSchema.safeParse({ id: UUID, capacity: 2 }).success).toBe(true);
    expect(updateResourceSchema.safeParse({ id: UUID, locationId: null }).success).toBe(true);
    expect(updateResourceSchema.safeParse({ capacity: 2 }).success).toBe(false);
  });

  it("only allows isActive of 0 or 1", () => {
    expect(updateResourceSchema.safeParse({ id: UUID, isActive: 2 }).success).toBe(false);
  });
});

describe("serviceNeedSchema", () => {
  const base = { quantity: 1, offsetMin: 0, durationMin: null };

  it("accepts a type or one specific resource, but not both or neither", () => {
    expect(serviceNeedSchema.safeParse({ ...base, resourceKind: "chair", resourceId: null }).success).toBe(true);
    expect(serviceNeedSchema.safeParse({ ...base, resourceKind: null, resourceId: UUID }).success).toBe(true);
    expect(serviceNeedSchema.safeParse({ ...base, resourceKind: "chair", resourceId: UUID }).success).toBe(false);
    expect(serviceNeedSchema.safeParse({ ...base, resourceKind: null, resourceId: null }).success).toBe(false);
  });

  it("bounds quantity, offset and duration", () => {
    const n = { ...base, resourceKind: "room" as const, resourceId: null };
    expect(serviceNeedSchema.safeParse({ ...n, quantity: 0 }).success).toBe(false);
    expect(serviceNeedSchema.safeParse({ ...n, quantity: 21 }).success).toBe(false);
    expect(serviceNeedSchema.safeParse({ ...n, offsetMin: -1 }).success).toBe(false);
    expect(serviceNeedSchema.safeParse({ ...n, durationMin: 0 }).success).toBe(false);
    expect(serviceNeedSchema.safeParse({ ...n, durationMin: 30 }).success).toBe(true);
  });
});

describe("setServiceNeedsSchema", () => {
  it("accepts an empty list (remove every need)", () => {
    expect(setServiceNeedsSchema.safeParse({ serviceId: UUID, needs: [] }).success).toBe(true);
  });
});
