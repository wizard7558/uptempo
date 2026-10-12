import { describe, it, expect } from "vitest";
import {
  createBookingSchema,
  rescheduleBookingSchema,
  cancelBookingSchema,
} from "@/lib/validators/booking";

describe("createBookingSchema", () => {
  const validInput = {
    staffId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
    clientId: "b2c3d4e5-f6a7-4901-bcde-f12345678901",
    serviceIds: ["c3d4e5f6-a7b8-4012-8def-123456789012"],
    startTime: "2026-03-15T10:00:00.000Z",
  };

  it("accepts valid input", () => {
    const result = createBookingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts multiple service IDs", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      serviceIds: [
        "c3d4e5f6-a7b8-4012-8def-123456789012",
        "d4e5f6a7-b8c9-4123-9efa-234567890123",
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty serviceIds array", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      serviceIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID for stylistId", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      staffId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for startTime", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      startTime: "not-a-datetime",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing clientId", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { clientId, ...rest } = validInput;
    const result = createBookingSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects flex booking without host appointment id", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      isDoubleBook: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects host id without flex flag", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      doubleBookParentAppointmentId: "d4e5f6a7-b8c9-4123-9efa-234567890123",
    });
    expect(result.success).toBe(false);
  });

  it("accepts flex booking with host appointment id", () => {
    const result = createBookingSchema.safeParse({
      ...validInput,
      isDoubleBook: true,
      doubleBookParentAppointmentId: "d4e5f6a7-b8c9-4123-9efa-234567890123",
    });
    expect(result.success).toBe(true);
  });
});

describe("rescheduleBookingSchema", () => {
  const validInput = {
    appointmentId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
    newStartTime: "2026-03-15T14:00:00.000Z",
  };

  it("accepts valid input without newStylistId", () => {
    const result = rescheduleBookingSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("accepts valid input with newStylistId", () => {
    const result = rescheduleBookingSchema.safeParse({
      ...validInput,
      newStaffId: "b2c3d4e5-f6a7-4901-bcde-f12345678901",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing appointmentId", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { appointmentId, ...rest } = validInput;
    const result = rescheduleBookingSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for newStartTime", () => {
    const result = rescheduleBookingSchema.safeParse({
      ...validInput,
      newStartTime: "tomorrow",
    });
    expect(result.success).toBe(false);
  });
});

describe("cancelBookingSchema", () => {
  it("accepts valid input with reason", () => {
    const result = cancelBookingSchema.safeParse({
      appointmentId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
      reason: "Client requested cancellation",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input without reason", () => {
    const result = cancelBookingSchema.safeParse({
      appointmentId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
    });
    expect(result.success).toBe(true);
  });

  it("rejects reason longer than 500 characters", () => {
    const result = cancelBookingSchema.safeParse({
      appointmentId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
      reason: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid appointmentId", () => {
    const result = cancelBookingSchema.safeParse({
      appointmentId: "invalid",
    });
    expect(result.success).toBe(false);
  });
});
