import { describe, expect, it } from "vitest";
import { canDeleteAppointmentPhoto } from "./rules";

const now = new Date("2026-10-11T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

describe("canDeleteAppointmentPhoto", () => {
  it("lets the uploader delete a photo from the last 24 hours", () => {
    expect(
      canDeleteAppointmentPhoto({
        role: "provider",
        userId: "u1",
        uploadedBy: "u1",
        createdAt: hoursAgo(23),
        now,
      }),
    ).toBe(true);
    expect(
      canDeleteAppointmentPhoto({
        role: "provider",
        userId: "u1",
        uploadedBy: "u1",
        createdAt: hoursAgo(24),
        now,
      }),
    ).toBe(true);
  });

  it("refuses a provider photo older than 24 hours and a photo someone else added", () => {
    expect(
      canDeleteAppointmentPhoto({
        role: "provider",
        userId: "u1",
        uploadedBy: "u1",
        createdAt: hoursAgo(25),
        now,
      }),
    ).toBe(false);
    expect(
      canDeleteAppointmentPhoto({
        role: "provider",
        userId: "u1",
        uploadedBy: "someone-else",
        createdAt: hoursAgo(1),
        now,
      }),
    ).toBe(false);
  });

  it("lets an owner delete a photo they did not add, even after 24 hours", () => {
    expect(
      canDeleteAppointmentPhoto({
        role: "owner",
        userId: "u1",
        uploadedBy: "someone-else",
        createdAt: hoursAgo(25),
        now,
      }),
    ).toBe(true);
    expect(
      canDeleteAppointmentPhoto({
        role: "admin",
        userId: "u1",
        uploadedBy: "someone-else",
        createdAt: hoursAgo(25),
        now,
      }),
    ).toBe(true);
  });
});
