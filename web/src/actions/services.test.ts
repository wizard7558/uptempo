import { describe, it, expect } from "vitest";
import { createServiceSchema, updateServiceSchema } from "@/lib/validators/service";
import { createClientSchema } from "@/lib/validators/client";
import { setOverrideSchema } from "@/lib/validators/override";

describe("class settings", () => {
  const base = { name: "Bootcamp", defaultDurationMinutes: 45 };

  it("requires spots when the service is a class", () => {
    expect(createServiceSchema.safeParse({ ...base, isClass: 1 }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...base, isClass: 1, classCapacity: null }).success).toBe(false);
    expect(createServiceSchema.safeParse({ ...base, isClass: 1, classCapacity: 12 }).success).toBe(true);
  });

  it("limits spots to 1 through 100", () => {
    for (const classCapacity of [0, 101, 2.5]) {
      expect(createServiceSchema.safeParse({ ...base, isClass: 1, classCapacity }).success).toBe(false);
    }
    for (const classCapacity of [1, 100]) {
      expect(createServiceSchema.safeParse({ ...base, isClass: 1, classCapacity }).success).toBe(true);
    }
  });

  it("does not need spots when it is not a class, and applies to updates too", () => {
    expect(createServiceSchema.safeParse({ ...base, isClass: 0 }).success).toBe(true);
    const id = "11111111-1111-4111-8111-111111111111";
    expect(updateServiceSchema.safeParse({ id, isClass: 1 }).success).toBe(false);
    expect(updateServiceSchema.safeParse({ id, isClass: 1, classCapacity: 8 }).success).toBe(true);
  });
});

describe("createServiceSchema", () => {
  it("accepts valid service input", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 60,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createServiceSchema.safeParse({
      name: "",
      defaultDurationMinutes: 60,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duration below minimum (5 minutes)", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 3,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duration above maximum (480 minutes)", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 500,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer duration", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 30.5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts minimum valid duration (5 minutes)", () => {
    const result = createServiceSchema.safeParse({
      name: "Quick Trim",
      defaultDurationMinutes: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts maximum valid duration (480 minutes)", () => {
    const result = createServiceSchema.safeParse({
      name: "Full Day Session",
      defaultDurationMinutes: 480,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional costCents", () => {
    const result = createServiceSchema.safeParse({
      name: "Haircut",
      defaultDurationMinutes: 30,
      priceCents: 5000,
      costCents: 2000,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateServiceSchema", () => {
  it("accepts valid update with all fields", () => {
    const result = updateServiceSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Updated Haircut",
      defaultDurationMinutes: 45,
    });
    expect(result.success).toBe(true);
  });

  it("accepts update with only id and name", () => {
    const result = updateServiceSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Updated Haircut",
    });
    expect(result.success).toBe(true);
  });

  it("rejects update without id", () => {
    const result = updateServiceSchema.safeParse({
      name: "Updated Haircut",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid id", () => {
    const result = updateServiceSchema.safeParse({
      id: "not-a-uuid",
      name: "Updated Haircut",
    });
    expect(result.success).toBe(false);
  });
});

describe("createClientSchema", () => {
  it("rejects when both email and phone are missing", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when both email and phone are null", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      email: null,
      phone: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts when email is provided without phone", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      email: "jane@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("accepts when phone is provided without email", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      phone: "555-1234",
    });
    expect(result.success).toBe(true);
  });

  it("accepts when both email and phone are provided", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "555-1234",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email format", () => {
    const result = createClientSchema.safeParse({
      name: "Jane Doe",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });
});

describe("setOverrideSchema", () => {
  it("accepts valid override input", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "123e4567-e89b-12d3-a456-426614174000",
      serviceId: "123e4567-e89b-12d3-a456-426614174001",
      durationMinutes: 90,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-uuid clientId", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "not-a-uuid",
      serviceId: "123e4567-e89b-12d3-a456-426614174001",
      durationMinutes: 90,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid serviceId", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "123e4567-e89b-12d3-a456-426614174000",
      serviceId: "not-a-uuid",
      durationMinutes: 90,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duration below minimum", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "123e4567-e89b-12d3-a456-426614174000",
      serviceId: "123e4567-e89b-12d3-a456-426614174001",
      durationMinutes: 2,
    });
    expect(result.success).toBe(false);
  });

  it("rejects duration above maximum", () => {
    const result = setOverrideSchema.safeParse({
      clientId: "123e4567-e89b-12d3-a456-426614174000",
      serviceId: "123e4567-e89b-12d3-a456-426614174001",
      durationMinutes: 500,
    });
    expect(result.success).toBe(false);
  });
});
