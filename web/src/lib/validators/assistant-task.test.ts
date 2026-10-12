import { describe, it, expect } from "vitest";
import { assignTaskSchema, taskCatalogSchema } from "./assistant-task";

const APPT = "11111111-1111-4111-8111-111111111111";
const ASSISTANT = "22222222-2222-4222-8222-222222222222";
const TYPE = "33333333-3333-4333-8333-333333333333";

describe("assignTaskSchema", () => {
  it("accepts a fully-specified appointment task", () => {
    const r = assignTaskSchema.safeParse({
      appointmentId: APPT,
      assignedTo: ASSISTANT,
      taskName: "Apply color",
      startTime: new Date("2026-04-29T10:00:00Z"),
      endTime: new Date("2026-04-29T10:30:00Z"),
    });
    expect(r.success).toBe(true);
  });

  it("accepts a standalone task (no appointmentId)", () => {
    const r = assignTaskSchema.safeParse({
      assignedTo: ASSISTANT,
      taskName: "Morning prep",
      startTime: new Date("2026-04-29T08:00:00Z"),
      endTime: new Date("2026-04-29T09:00:00Z"),
    });
    expect(r.success).toBe(true);
  });

  it("accepts explicit null appointmentId for standalone task", () => {
    const r = assignTaskSchema.safeParse({
      appointmentId: null,
      assignedTo: ASSISTANT,
      taskName: "Color mixing",
      startTime: new Date("2026-04-29T08:00:00Z"),
      endTime: new Date("2026-04-29T09:00:00Z"),
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed appointmentId when provided", () => {
    const r = assignTaskSchema.safeParse({
      appointmentId: "not-a-uuid",
      assignedTo: ASSISTANT,
      taskName: "Something",
      startTime: new Date("2026-04-29T08:00:00Z"),
      endTime: new Date("2026-04-29T09:00:00Z"),
    });
    expect(r.success).toBe(false);
  });

  it("rejects when end <= start", () => {
    const r = assignTaskSchema.safeParse({
      assignedTo: ASSISTANT,
      taskName: "Bad time",
      startTime: new Date("2026-04-29T10:00:00Z"),
      endTime: new Date("2026-04-29T09:00:00Z"),
    });
    expect(r.success).toBe(false);
  });

  it("accepts optional taskTypeId from catalog", () => {
    const r = assignTaskSchema.safeParse({
      assignedTo: ASSISTANT,
      taskTypeId: TYPE,
      taskName: "Standard prep",
      startTime: new Date("2026-04-29T08:00:00Z"),
      endTime: new Date("2026-04-29T08:30:00Z"),
    });
    expect(r.success).toBe(true);
  });
});

describe("taskCatalogSchema", () => {
  it("accepts valid catalog entry", () => {
    const r = taskCatalogSchema.safeParse({
      name: "Morning prep",
      defaultDurationMinutes: 30,
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    const r = taskCatalogSchema.safeParse({
      name: "",
      defaultDurationMinutes: 30,
    });
    expect(r.success).toBe(false);
  });

  it("rejects duration below 5 minutes", () => {
    const r = taskCatalogSchema.safeParse({
      name: "Tiny",
      defaultDurationMinutes: 3,
    });
    expect(r.success).toBe(false);
  });

  it("rejects duration above 120 minutes", () => {
    const r = taskCatalogSchema.safeParse({
      name: "Huge",
      defaultDurationMinutes: 999,
    });
    expect(r.success).toBe(false);
  });
});
