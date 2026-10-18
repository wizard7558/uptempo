import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getAppointment` is a server action, so any browser can call it. It must stay
 * behind the staff guard and must only read the signed-in staff member's own
 * salon. Internal server code (booking confirmations, the cancel and reschedule
 * pages) uses `loadAppointmentForTenant` instead.
 */

class AuthError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}
const requireStaff = vi.fn();
vi.mock("@/lib/auth/rbac", () => ({
  AuthError,
  requireStaff,
  requireRole: requireStaff,
  requireAdminRole: requireStaff,
  getUserRole: vi.fn(),
}));
const loadAppointmentForTenant = vi.fn();
vi.mock("@/lib/appointments/load", () => ({ loadAppointmentForTenant }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAppointment action", () => {
  it("throws UNAUTHENTICATED without a staff session and never loads data", async () => {
    requireStaff.mockRejectedValue(new AuthError("UNAUTHENTICATED", "Not signed in"));
    const { getAppointment } = await import("./appointments");
    await expect(getAppointment("appt-1")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(loadAppointmentForTenant).not.toHaveBeenCalled();
  });

  it("loads from the session's salon, not a caller-supplied one", async () => {
    requireStaff.mockResolvedValue({ userId: "u1", role: "owner", tenantSlug: "salon-a" });
    loadAppointmentForTenant.mockResolvedValue({ id: "appt-1" });
    const { getAppointment } = await import("./appointments");
    await expect(getAppointment("appt-1")).resolves.toEqual({ id: "appt-1" });
    expect(loadAppointmentForTenant).toHaveBeenCalledWith("salon-a", "appt-1");
  });
});
