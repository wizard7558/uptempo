import { describe, it, expect } from "vitest";
import {
  createStaffSchema,
  updateStaffSchema,
} from "./staff";

const ID = "11111111-1111-4111-8111-111111111111";

describe("createStaffSchema", () => {
  it("accepts the minimal payload (just displayName)", () => {
    const r = createStaffSchema.safeParse({ displayName: "Sarah" });
    expect(r.success).toBe(true);
  });

  it("rejects empty displayName", () => {
    const r = createStaffSchema.safeParse({ displayName: "" });
    expect(r.success).toBe(false);
  });

  it("accepts a valid email", () => {
    const r = createStaffSchema.safeParse({
      displayName: "Sarah",
      email: "sarah@example.com",
    });
    expect(r.success).toBe(true);
  });

  it("treats empty-string email as null", () => {
    const r = createStaffSchema.safeParse({
      displayName: "Sarah",
      email: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBeNull();
  });

  it("rejects malformed email", () => {
    const r = createStaffSchema.safeParse({
      displayName: "Sarah",
      email: "not-an-email",
    });
    expect(r.success).toBe(false);
  });

  it("accepts phone of any reasonable shape", () => {
    const r = createStaffSchema.safeParse({
      displayName: "Sarah",
      phone: "(555) 123-4567",
    });
    expect(r.success).toBe(true);
  });

  it("treats empty-string phone as null", () => {
    const r = createStaffSchema.safeParse({
      displayName: "Sarah",
      phone: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBeNull();
  });

  it("rejects phone longer than 50 chars", () => {
    const r = createStaffSchema.safeParse({
      displayName: "Sarah",
      phone: "1".repeat(51),
    });
    expect(r.success).toBe(false);
  });
});

describe("updateStaffSchema", () => {
  it("accepts an id-only payload (no fields to change)", () => {
    const r = updateStaffSchema.safeParse({ id: ID });
    expect(r.success).toBe(true);
  });

  it("accepts null to clear email/phone", () => {
    const r = updateStaffSchema.safeParse({
      id: ID,
      email: null,
      phone: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid email on update", () => {
    const r = updateStaffSchema.safeParse({
      id: ID,
      email: "garbage",
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed UUID id", () => {
    const r = updateStaffSchema.safeParse({ id: "not-a-uuid" });
    expect(r.success).toBe(false);
  });
});
