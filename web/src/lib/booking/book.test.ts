import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/terms/server", () => ({ getT: async () => (k: string) => k }));
vi.mock("@/lib/db/tenant", () => ({ withTenantDb: vi.fn() }));
vi.mock("@/lib/scheduling/service", () => ({ checkBooking: vi.fn(), resolveBookingLocation: vi.fn() }));
vi.mock("@/lib/services/duration", () => ({ getMultiServiceDuration: vi.fn() }));

import {
  bookingCodeForDbError,
  isResourceConflict,
  RESOURCE_RETRY_ATTEMPTS,
  withResourceRetry,
} from "./book";

/** Mimics what postgres-js raises, wrapped the way Drizzle wraps it. */
const pgError = (code: string, constraint_name?: string) =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("pg"), { code, constraint_name }),
  });

const resourceRace = () => pgError("23P01", "appointment_resources_no_overlap");

describe("isResourceConflict and bookingCodeForDbError", () => {
  it("recognizes both resource constraints", () => {
    expect(isResourceConflict(resourceRace())).toBe(true);
    expect(isResourceConflict(pgError("23P01", "appointment_resources_capacity"))).toBe(true);
  });

  it("does not treat the staff lane or other errors as resource conflicts", () => {
    expect(isResourceConflict(pgError("23P01", "appointments_no_overlap"))).toBe(false);
    expect(isResourceConflict(pgError("23505", "appointment_resources_pkey"))).toBe(false);
    expect(isResourceConflict(new Error("boom"))).toBe(false);
  });

  it("maps database races to failure codes", () => {
    expect(bookingCodeForDbError(resourceRace())).toBe("RESOURCE_TAKEN");
    expect(bookingCodeForDbError(pgError("23P01", "appointments_no_overlap"))).toBe("SLOT_TAKEN");
    expect(bookingCodeForDbError(pgError("23P01"))).toBe("SLOT_TAKEN");
    expect(bookingCodeForDbError(pgError("23503"))).toBeNull();
    expect(bookingCodeForDbError(undefined)).toBeNull();
  });
});

describe("withResourceRetry", () => {
  it("allows three attempts by default", () => {
    expect(RESOURCE_RETRY_ATTEMPTS).toBe(3);
  });

  it("returns the first result without retrying", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    expect(await withResourceRetry(3, run)).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a lost resource race and returns the later success", async () => {
    const run = vi.fn().mockRejectedValueOnce(resourceRace()).mockResolvedValue("ok");
    expect(await withResourceRetry(3, run)).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after the last attempt and throws the race error", async () => {
    const run = vi.fn().mockRejectedValue(resourceRace());
    await expect(withResourceRetry(3, run)).rejects.toMatchObject({ cause: { code: "23P01" } });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors, including a staff-lane exclusion violation", async () => {
    const lane = vi.fn().mockRejectedValue(pgError("23P01", "appointments_no_overlap"));
    await expect(withResourceRetry(3, lane)).rejects.toBeDefined();
    expect(lane).toHaveBeenCalledTimes(1);
    const other = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withResourceRetry(3, other)).rejects.toThrow("boom");
    expect(other).toHaveBeenCalledTimes(1);
  });
});
