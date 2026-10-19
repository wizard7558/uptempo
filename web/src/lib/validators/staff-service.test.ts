import { describe, it, expect } from "vitest";
import {
  setStaffServiceSchema,
  bulkSetStaffOfferingsSchema,
  removeStaffServiceSchema,
} from "./staff-service";

// Real UUIDv4 strings — Zod 4's .uuid() validates the version + variant nibbles.
const STAFF = "11111111-1111-4111-8111-111111111111";
const SERVICE = "22222222-2222-4222-8222-222222222222";

describe("setStaffServiceSchema", () => {
  it("accepts the minimal payload", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
    });
    expect(r.success).toBe(true);
  });

  it("accepts null overrides (clearing)", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      priceCents: null,
      durationMinutes: null,
      activeMinutes: null,
      processingMinutes: null,
      customName: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative price", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      priceCents: -100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects duration below 5 minutes", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      durationMinutes: 3,
    });
    expect(r.success).toBe(false);
  });

  it("rejects duration above 480 minutes", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      durationMinutes: 9999,
    });
    expect(r.success).toBe(false);
  });

  it("rejects active minutes set without processing minutes", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      activeMinutes: 30,
    });
    expect(r.success).toBe(false);
  });

  it("rejects processing minutes set without active minutes", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      processingMinutes: 30,
    });
    expect(r.success).toBe(false);
  });

  it("rejects active+processing exceeding overridden duration", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      durationMinutes: 60,
      activeMinutes: 40,
      processingMinutes: 25,
    });
    expect(r.success).toBe(false);
  });

  it("accepts active+processing equal to overridden duration", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      durationMinutes: 60,
      activeMinutes: 30,
      processingMinutes: 30,
    });
    expect(r.success).toBe(true);
  });

  it("rejects custom name longer than 100 chars", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
      customName: "x".repeat(101),
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid staff UUID", () => {
    const r = setStaffServiceSchema.safeParse({
      staffId: "not-a-uuid",
      serviceId: SERVICE,
    });
    expect(r.success).toBe(false);
  });
});

describe("bulkSetStaffOfferingsSchema", () => {
  it("accepts empty service list (clears all offerings)", () => {
    const r = bulkSetStaffOfferingsSchema.safeParse({
      staffId: STAFF,
      serviceIds: [],
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed UUIDs in the list", () => {
    const r = bulkSetStaffOfferingsSchema.safeParse({
      staffId: STAFF,
      serviceIds: [SERVICE, "bad"],
    });
    expect(r.success).toBe(false);
  });
});

describe("removeStaffServiceSchema", () => {
  it("accepts a valid pair", () => {
    const r = removeStaffServiceSchema.safeParse({
      staffId: STAFF,
      serviceId: SERVICE,
    });
    expect(r.success).toBe(true);
  });
});
